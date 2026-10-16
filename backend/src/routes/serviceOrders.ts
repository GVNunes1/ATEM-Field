import { supabaseAdmin as osSupabase } from '../services/supabase';
import { Router, Response } from 'express';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import {
  AuthenticatedRequest,
  requireAuthentication
} from '../security/authService';

const router = Router();
const execFileAsync = promisify(execFile);

function getServiceOrderPdfDirectory(): string {
  const candidates = [
    path.resolve(process.cwd(), 'data', 'service-orders'),
    path.resolve(process.cwd(), 'backend', 'data', 'service-orders'),
    path.resolve(__dirname, '..', '..', 'data', 'service-orders')
  ];
  for (const dir of candidates) {
    if (existsSync(dir) || existsSync(path.dirname(dir))) return dir;
  }
  return path.resolve(process.cwd(), 'data', 'service-orders');
}

const serviceOrderPdfDirectory = getServiceOrderPdfDirectory();
const signatureFields = ['Assinatura_Tecnico', 'Assinatura_Cliente'] as const;
const maxSignatureBytes = 1024 * 1024;
const maxSignatureDimension = 4096;
const maxSignaturePixels = 4 * 1024 * 1024;

class InvalidSignatureError extends Error {}

function signatureDimensions(image: Buffer, kind: string): [number, number] | undefined {
  if (kind === 'png') {
    if (image.length < 45 || !image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      || image.readUInt32BE(8) !== 13 || image.toString('ascii', 12, 16) !== 'IHDR') return;
    let offset = 8;
    let hasImageData = false;
    while (offset + 12 <= image.length) {
      const length = image.readUInt32BE(offset);
      if (length > image.length - offset - 12) return;
      const chunk = image.toString('ascii', offset + 4, offset + 8);
      if (chunk === 'IHDR' && offset !== 8) return;
      if (chunk === 'IDAT' && length > 0) hasImageData = true;
      offset += length + 12;
      if (chunk === 'IEND') {
        return length === 0 && offset === image.length && hasImageData
          ? [image.readUInt32BE(16), image.readUInt32BE(20)] : undefined;
      }
    }
    return;
  }

  if (image.length < 4 || image.readUInt16BE(0) !== 0xffd8
    || image.readUInt16BE(image.length - 2) !== 0xffd9) return;
  let offset = 2;
  let dimensions: [number, number] | undefined;
  while (offset < image.length - 2) {
    if (image[offset++] !== 0xff) return;
    while (image[offset] === 0xff) offset++;
    const marker = image[offset++];
    if (marker === undefined || marker === 0 || marker === 0xd8 || marker === 0xd9) return;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > image.length - 2) return;
    const length = image.readUInt16BE(offset);
    if (length < 2 || length > image.length - 2 - offset) return;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8) return;
      dimensions = [image.readUInt16BE(offset + 5), image.readUInt16BE(offset + 3)];
    }
    offset += length;
    if (marker === 0xda) return length >= 6 && offset < image.length - 2 ? dimensions : undefined;
  }
}

function validateSignature(value: unknown, field: string): string {
  if (value === undefined || value === null || value === '') return '';
  const invalid = () => new InvalidSignatureError(`${field}: envie uma imagem PNG ou JPEG em base64 de até 1 MB.`);
  if (typeof value !== 'string' || value.length > 24 + 4 * Math.ceil(maxSignatureBytes / 3)) throw invalid();
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[0] !== value) throw invalid();
  const image = Buffer.from(match[2], 'base64');
  if (!image.length || image.length > maxSignatureBytes || image.toString('base64') !== match[2]) throw invalid();
  const dimensions = signatureDimensions(image, match[1]);
  if (!dimensions || dimensions.some(size => size < 1 || size > maxSignatureDimension)
    || dimensions[0] * dimensions[1] > maxSignaturePixels) throw invalid();
  return value;
}

type ServiceOrderRecord = {
  id: string;
  os_number?: string | null;
  status: 'unsigned' | 'signed';
  client_name?: string | null;
  serial_number?: string | null;
  equipment_name?: string | null;
  technician_name?: string | null;
  service_date?: string | null;
  form_data?: Record<string, unknown> | null;
  pdf_filename?: string | null;
  pdf_url?: string | null;
  drive_file_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type DriveFileResult = {
  success: boolean;
  found?: boolean;
  file_id?: string;
  filename?: string;
  web_view_url?: string;
  download_url?: string;
  error?: string;
};

function normalizedName(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]/g, '');
}

function technicianForOrder(order: ServiceOrderRecord): string {
  return String(order.technician_name || order.form_data?.Nome_Tecnico || '');
}

function canManageOrder(req: AuthenticatedRequest, order: ServiceOrderRecord): boolean {
  if (!req.user) return false;
  if (['admin', 'manager', 'supervisor', 'commercial'].includes(req.user.role)) return true;
  if (req.user.role === 'technician') return true;
  return normalizedName(technicianForOrder(order)) === normalizedName(req.user?.name);
}

function orderError(res: Response, error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message : fallback;
  if (error instanceof InvalidSignatureError) {
    res.status(400).json({ success: false, error: message });
    return;
  }
  console.error('[service-orders]', error);
  res.status(500).json({ success: false, error: message || fallback });
}

function normalizeDownloadUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.trim();
}

function safeFileSegment(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'OS';
}

function legacyFilenameSegment(value: unknown): string {
  return String(value || '')
    .replace(/[\\/*?:"<>|]/g, '-')
    .trim()
    .slice(0, 100) || 'AUTO';
}

function timestampForFilename(): string {
  const now = new Date();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('');
  const time = [String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0'), String(now.getSeconds()).padStart(2, '0')].join('');
  return `${date}_${time}`;
}

function originalOrderReference(formData: Record<string, any>): string {
  const serial = legacyFilenameSegment(String(formData.Serie || '').trim().toUpperCase());
  const serviceDate = String(formData.Data || '').replace(/\D/g, '');
  if (serial && serial !== 'AUTO' && serviceDate) return `${serial}_${serviceDate}`;
  return legacyFilenameSegment(formData.Atendimento || formData.Serie || Date.now());
}

function driveFileId(value: unknown): string | undefined {
  const url = String(value || '');
  const pathMatch = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i);
  if (pathMatch?.[1]) return pathMatch[1];
  const queryMatch = url.match(/[?&]id=([^&#]+)/i);
  return queryMatch?.[1] ? decodeURIComponent(queryMatch[1]) : undefined;
}

function localPdfPath(filename: string): string {
  return path.join(serviceOrderPdfDirectory, path.basename(filename));
}

function localPdfDownloadUrl(orderId: string): string {
  return `/api/service-orders/${encodeURIComponent(orderId)}/pdf`;
}

async function readGeneratedLocalPdf(order: ServiceOrderRecord): Promise<Buffer | null> {
  if (!order.pdf_filename) return null;

  try {
    const pdf = await readFile(localPdfPath(order.pdf_filename));
    return pdf.subarray(0, 5).toString('ascii') === '%PDF-' ? pdf : null;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function pythonInvocation(): { command: string; prefixArgs: string[] } {
  const configured = process.env.PYTHON_EXECUTABLE?.trim();
  if (configured) return { command: configured, prefixArgs: [] };

  const venvCandidates = process.platform === 'win32'
    ? [
        path.resolve(process.cwd(), '.venv', 'Scripts', 'python.exe'),
        path.resolve(process.cwd(), 'backend', '.venv', 'Scripts', 'python.exe'),
        path.resolve(__dirname, '..', '..', '.venv', 'Scripts', 'python.exe')
      ]
    : [
        path.resolve(process.cwd(), '.venv', 'bin', 'python'),
        path.resolve(process.cwd(), 'backend', '.venv', 'bin', 'python'),
        path.resolve(__dirname, '..', '..', '.venv', 'bin', 'python')
      ];

  for (const venvPath of venvCandidates) {
    if (existsSync(venvPath)) return { command: venvPath, prefixArgs: [] };
  }

  return process.platform === 'win32'
    ? { command: 'py', prefixArgs: ['-3'] }
    : { command: 'python3', prefixArgs: [] };
}

function resolveServiceScript(scriptName: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'src', 'services', scriptName),
    path.resolve(process.cwd(), 'backend', 'src', 'services', scriptName),
    path.resolve(__dirname, '..', 'services', scriptName),
    path.resolve(__dirname, '..', '..', 'src', 'services', scriptName)
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function parseScriptResult(stdout: string): any {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}

async function runPythonService(scriptName: string, args: string[], timeout = 90_000): Promise<any> {
  const python = pythonInvocation();
  const scriptPath = resolveServiceScript(scriptName);
  try {
    const { stdout } = await execFileAsync(
      python.command,
      [...python.prefixArgs, scriptPath, ...args],
      { timeout, maxBuffer: 1024 * 1024 }
    );
    const result = parseScriptResult(stdout);
    if (!result?.success) throw new Error(result?.error || `${scriptName} não concluiu a operação.`);
    return result;
  } catch (error: any) {
    const result = error?.stdout ? parseScriptResult(String(error.stdout)) : null;
    throw new Error(result?.error || error?.message || `Falha ao executar ${scriptName}.`);
  }
}

async function driveCommand(args: string[]): Promise<DriveFileResult> {
  return runPythonService('service_order_drive.py', args, 120_000) as Promise<DriveFileResult>;
}

async function findOriginalDriveFile(order: ServiceOrderRecord): Promise<DriveFileResult | null> {
  const currentUrl = String(order.pdf_url || '');
  const currentFileId = driveFileId(currentUrl);
  if (currentFileId && /^https?:\/\//i.test(currentUrl)) {
    return {
      success: true,
      found: true,
      file_id: currentFileId,
      filename: order.pdf_filename || undefined,
      web_view_url: currentUrl
    };
  }
  if (!order.pdf_filename) return null;

  try {
    const result = await driveCommand(['find', order.pdf_filename, String(order.status === 'signed')]);
    if (!result.found || !result.web_view_url) return null;

    if (result.web_view_url !== order.pdf_url) {
      const { error } = await osSupabase
        .from('service_orders')
        .update({ pdf_url: result.web_view_url })
        .eq('id', order.id);
      if (error) console.warn('[service-orders] Não foi possível atualizar a URL histórica do Drive:', error);
    }
    return result;
  } catch (error) {
    console.warn('[service-orders] Google Drive não respondeu à busca de arquivo:', error);
    return null;
  }
}

async function upsertEquipmentFromForm(formData: Record<string, any>): Promise<void> {
  const serial = String(formData.Serie || '').trim();
  if (!serial || serial.toUpperCase() === 'AUTO') return;

  try {
    await osSupabase.from('equipments').upsert({
      serial_number: serial,
      equipment: String(formData.Equipamento || '').trim() || null,
      brand: String(formData.Marca || '').trim() || null,
      model: String(formData.Modelo || '').trim() || null,
      tag: String(formData.Patrimonio || '').trim() || null,
      client: String(formData.Cliente || '').trim() || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'serial_number' });
  } catch (err) {
    console.warn('[service-orders] Atualização secundária de catálogo ignorada:', err);
  }
}

async function safeUpsertEquipment(matched: Record<string, any>): Promise<void> {
  try {
    await osSupabase.from('equipments').upsert(matched, { onConflict: 'serial_number' });
  } catch (err) {
    console.warn('[service-orders] Atualização secundária de equipamento ignorada:', err);
  }
}


async function generateLocalPdf(orderId: string, filename: string, formData: Record<string, any>): Promise<string> {
  // Both generation routes share this boundary; no supplied image URL reaches Python.
  for (const field of signatureFields) formData[field] = validateSignature(formData[field], field);
  await mkdir(serviceOrderPdfDirectory, { recursive: true });
  const inputPath = path.join(serviceOrderPdfDirectory, `${safeFileSegment(orderId)}.json`);
  const outputPath = localPdfPath(filename);

  try {
    await writeFile(inputPath, JSON.stringify(formData), 'utf8');
    await runPythonService('service_order_pdf.py', [inputPath, outputPath]);
    if (!existsSync(outputPath)) throw new Error('O gerador PAT01-F2 não produziu o arquivo PDF.');
    return outputPath;
  } finally {
    await unlink(inputPath).catch(() => undefined);
  }
}

router.use(requireAuthentication);

// Local downloads must not depend on Google Drive, Supabase, or a later request
// to the backend's ephemeral filesystem. The PDF is returned in this response.
router.post('/generate-local', async (req: AuthenticatedRequest, res: Response) => {
  const rawForm = req.body?.form_data;
  if (!rawForm || typeof rawForm !== 'object' || Array.isArray(rawForm)) {
    res.status(400).json({ success: false, error: 'Os dados da ordem de serviço são inválidos.' });
    return;
  }

  const formData: Record<string, any> = { ...rawForm };
  if (req.user?.role === 'technician' && !String(formData.Nome_Tecnico || '').trim()) {
    formData.Nome_Tecnico = req.user.name;
  }

  let pdfPath: string | undefined;
  try {
    const signed = Boolean(formData.Assinatura_Tecnico || formData.Assinatura_Cliente);
    const orderReference = originalOrderReference(formData);
    formData.Atendimento = formData.Atendimento || orderReference;
    const uniqueId = randomUUID();
    const filename = `${signed ? 'SIGNED_OS' : 'OS'}_${orderReference}_${timestampForFilename()}_${uniqueId.slice(0, 8)}.pdf`;
    pdfPath = localPdfPath(filename);
    await generateLocalPdf(uniqueId, filename, formData);
    void upsertEquipmentFromForm(formData);
    const pdf = await readFile(pdfPath);
    if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('O gerador PAT01-F2 não produziu um PDF válido.');
    }
    res.set('Cache-Control', 'private, no-store');
    res.type('application/pdf');
    res.attachment(filename);
    res.send(pdf);
  } catch (error) {
    orderError(res, error, 'Não foi possível gerar o PDF para download local.');
  } finally {
    if (pdfPath) await unlink(pdfPath).catch(() => undefined);
  }
});

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await osSupabase
      .from('service_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const orders = (data || []) as ServiceOrderRecord[];
    const visibleOrders = (req.user?.role === 'admin'
      ? orders
      : orders.filter(order => canManageOrder(req, order)))
      .map(order => ({
        ...order,
        pdf_url: normalizeDownloadUrl(
          order.pdf_url || (order.pdf_filename ? localPdfDownloadUrl(order.id) : undefined)
        )
      }));

    res.set('Cache-Control', 'no-store');
    res.json({ success: true, orders: visibleOrders });
  } catch (error) {
    orderError(res, error, 'Não foi possível carregar as ordens de serviço.');
  }
});

router.get('/equipment', async (req: AuthenticatedRequest, res: Response) => {
  const rawSerial = String(req.query.serial || '').trim();
  if (rawSerial.length < 2 || rawSerial.length > 80) {
    res.status(400).json({ success: false, error: 'Informe ao menos dois caracteres do número de série.' });
    return;
  }

  try {
    const fields = 'id, serial_number, equipment, brand, model, tag, client';
    // 1. Exact match on equipments catalog
    let { data, error } = await osSupabase
      .from('equipments')
      .select(fields)
      .ilike('serial_number', rawSerial)
      .limit(1);

    // 2. Partial match on equipments catalog if exact match not found
    if (!error && (!data || data.length === 0)) {
      const sanitized = rawSerial.replace(/[%_\\]/g, '');
      if (sanitized.length >= 2) {
        const fallback = await osSupabase
          .from('equipments')
          .select(fields)
          .ilike('serial_number', `%${sanitized}%`)
          .limit(1);
        data = fallback.data;
        error = fallback.error;
      }
    }

    // 3. Fallback to service_orders table if not found in catalog
    if (!error && (!data || data.length === 0)) {
      const sanitized = rawSerial.replace(/[%_\\]/g, '');
      const soResult = await osSupabase
        .from('service_orders')
        .select('serial_number, equipment_name, client_name, form_data')
        .ilike('serial_number', `%${sanitized}%`)
        .limit(1);

      if (soResult.data && soResult.data.length > 0) {
        const row = soResult.data[0];
        const formData = (row.form_data || {}) as Record<string, any>;
        const matched = {
          id: `so-${row.serial_number || rawSerial}`,
          serial_number: row.serial_number || rawSerial,
          equipment: row.equipment_name || formData.Equipamento || null,
          brand: formData.Marca || null,
          model: formData.Modelo || null,
          tag: formData.Patrimonio || null,
          client: row.client_name || formData.Cliente || null
        };
        void safeUpsertEquipment(matched);
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, equipment: matched });
        return;
      }
    }

    // 4. Fallback to appointment_equipments if still not found
    if (!error && (!data || data.length === 0)) {
      const sanitized = rawSerial.replace(/[%_\\]/g, '');
      const aeResult = await osSupabase
        .from('appointment_equipments')
        .select('serial_number, model, tag, category_id, appointment_id')
        .ilike('serial_number', `%${sanitized}%`)
        .limit(1);

      if (aeResult.data && aeResult.data.length > 0) {
        const ae = aeResult.data[0];
        let clientName: string | null = null;
        let categoryName: string | null = null;
        if (ae.appointment_id) {
          const appt = await osSupabase.from('appointments').select('client_name').eq('id', ae.appointment_id).maybeSingle();
          clientName = appt.data?.client_name || null;
        }
        if (ae.category_id) {
          const cat = await osSupabase.from('equipment_categories').select('name').eq('id', ae.category_id).maybeSingle();
          categoryName = cat.data?.name || null;
        }
        const matched = {
          id: `ae-${ae.serial_number}`,
          serial_number: ae.serial_number,
          equipment: categoryName || 'Equipamento',
          brand: null,
          model: ae.model || null,
          tag: ae.tag || null,
          client: clientName || null
        };
        void safeUpsertEquipment(matched);
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, equipment: matched });
        return;
      }
    }

    if (error) {
      console.warn('[service-orders] Erro na consulta de equipamentos:', error);
    }

    res.set('Cache-Control', 'no-store');
    res.json({ success: true, equipment: data?.[0] || null });
  } catch (error) {
    console.warn('[service-orders] Exceção na consulta de equipamentos:', error);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, equipment: null });
  }
});

router.post('/generate', async (req: AuthenticatedRequest, res: Response) => {
  const rawForm = req.body?.form_data;
  if (!rawForm || typeof rawForm !== 'object' || Array.isArray(rawForm)) {
    res.status(400).json({ success: false, error: 'Os dados da ordem de serviço são inválidos.' });
    return;
  }

  const formData: Record<string, any> = { ...rawForm };
  if (req.user?.role === 'technician' && !String(formData.Nome_Tecnico || '').trim()) {
    formData.Nome_Tecnico = req.user.name;
  }

  const rawClient = String(formData.Cliente || '').trim();
  const clientName = rawClient || 'A PREENCHER';
  const technicianName = String(formData.Nome_Tecnico || '').trim() || (req.user?.name || 'Técnico Responsável');
  formData.Cliente = rawClient;
  formData.Nome_Tecnico = technicianName;

  try {
    const originalId = String(formData._original_id || '').trim();
    let originalOrder: ServiceOrderRecord | null = null;
    if (originalId) {
      const { data, error: originalError } = await osSupabase
        .from('service_orders')
        .select('*')
        .eq('id', originalId)
        .maybeSingle();

      if (originalError) throw originalError;
      originalOrder = data as ServiceOrderRecord | null;
      if (originalOrder && !canManageOrder(req, originalOrder)) {
        res.status(403).json({ success: false, error: 'Você não possui permissão para editar esta ordem de serviço.' });
        return;
      }
      const recovery = originalOrder?.form_data?._recovery as { partial_form?: boolean } | undefined;
      if (recovery?.partial_form) {
        res.status(409).json({ success: false, error: 'Esta OS foi recuperada de um PDF e possui dados parciais. Preserve o original e crie uma nova OS para registrar alterações.' });
        return;
      }
    }

    const signed = Boolean(formData.Assinatura_Tecnico || formData.Assinatura_Cliente);
    const orderReference = originalOrderReference(formData);
    formData.Atendimento = formData.Atendimento || orderReference;
    const generatedFilename = `${signed ? 'SIGNED_OS' : 'OS'}_${orderReference}_${timestampForFilename()}.pdf`;
    const orderId = generatedFilename.replace(/\.pdf$/i, '');
    const pdfPath = await generateLocalPdf(orderId, generatedFilename, formData);
    void upsertEquipmentFromForm(formData);
    let uploadedFile: DriveFileResult | null = null;
    let orderSaved = false;
    let keepLocalPdf = false;

    try {
      let driveWarning: string | undefined;
      try {
        uploadedFile = await driveCommand(['upload', pdfPath, generatedFilename, String(signed)]);
        if (!uploadedFile.found || !uploadedFile.web_view_url) {
          throw new Error('O Google Drive não confirmou o armazenamento do PDF.');
        }
      } catch (uploadError) {
        if (uploadedFile?.file_id) {
          await driveCommand(['delete', uploadedFile.file_id]).catch(() => undefined);
        }
        uploadedFile = null;
        driveWarning = 'O PDF foi gerado e está disponível para download, mas o envio ao Google Drive ficou pendente.';
        console.warn('[service-orders] Upload ao Google Drive falhou; mantendo o PDF local para download:', uploadError);
      }

      const order: ServiceOrderRecord = {
        id: orderId,
        os_number: orderReference,
        status: signed ? 'signed' : 'unsigned',
        client_name: clientName,
        serial_number: String(formData.Serie || ''),
        equipment_name: String(formData.Equipamento || ''),
        technician_name: technicianName,
        service_date: String(formData.Data || ''),
        form_data: formData,
        pdf_filename: generatedFilename,
        pdf_url: uploadedFile?.web_view_url || null,
        drive_file_id: uploadedFile?.file_id || null,
        updated_at: new Date().toISOString()
      };

      const { error: upsertError } = await osSupabase
        .from('service_orders')
        .upsert(order);
      if (upsertError) throw upsertError;
      orderSaved = true;
      keepLocalPdf = !uploadedFile?.web_view_url;

      if (originalId && originalId !== orderId) {
        const { error: deleteOriginalError } = await osSupabase
          .from('service_orders')
          .delete()
          .eq('id', originalId);
        if (deleteOriginalError) {
          console.warn('[service-orders] A nova OS foi salva, mas o registro anterior não pôde ser removido:', deleteOriginalError);
        } else if (originalOrder && uploadedFile?.web_view_url) {
          try {
            const oldDriveFile = await findOriginalDriveFile(originalOrder);
            if (oldDriveFile?.file_id) await driveCommand(['delete', oldDriveFile.file_id]);
          } catch (cleanupError) {
            console.warn('[service-orders] A OS foi atualizada, mas o PDF anterior não pôde ser removido do Drive:', cleanupError);
          }
        }
      }

      const downloadUrl = uploadedFile?.web_view_url || localPdfDownloadUrl(orderId);
      res.json({
        success: true,
        order: { ...order, pdf_url: downloadUrl },
        filename: generatedFilename,
        download_url: downloadUrl,
        drive_uploaded: Boolean(uploadedFile?.web_view_url),
        warning: driveWarning
      });
    } catch (persistenceError) {
      if (!orderSaved && uploadedFile?.file_id) {
        await driveCommand(['delete', uploadedFile.file_id]).catch(() => undefined);
      }
      throw persistenceError;
    } finally {
      if (!keepLocalPdf) await unlink(pdfPath).catch(() => undefined);
    }
  } catch (error) {
    orderError(res, error, 'Não foi possível gerar a ordem de serviço.');
  }
});

router.get('/:id/pdf', async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id || '').trim();
  try {
    const { data: order, error } = await osSupabase
      .from('service_orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!order) {
      res.status(404).json({ success: false, error: 'Ordem de serviço não encontrada.' });
      return;
    }
    if (!canManageOrder(req, order as ServiceOrderRecord)) {
      res.status(403).json({ success: false, error: 'Você não possui permissão para baixar esta ordem de serviço.' });
      return;
    }

    const existingDriveUrl = String(order.pdf_url || '').trim();
    if (/^https?:\/\//i.test(existingDriveUrl) && driveFileId(existingDriveUrl)) {
      res.set('Cache-Control', 'private, no-store');
      res.redirect(302, existingDriveUrl);
      return;
    }

    const localPdf = await readGeneratedLocalPdf(order as ServiceOrderRecord);
    if (localPdf) {
      res.set('Cache-Control', 'private, no-store');
      res.type('application/pdf');
      res.attachment(path.basename(order.pdf_filename || `${id}.pdf`));
      res.send(localPdf);
      return;
    }

    const driveFile = await findOriginalDriveFile(order as ServiceOrderRecord);
    if (driveFile?.web_view_url) {
      res.set('Cache-Control', 'private, no-store');
      res.redirect(302, driveFile.web_view_url);
      return;
    }

    res.status(410).json({
      success: false,
      error: 'O arquivo original desta OS não foi encontrado no Google Drive. Nenhum PDF foi recriado.'
    });
  } catch (error) {
    orderError(res, error, 'Não foi possível carregar o PDF da ordem de serviço.');
  }
});

router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!id) {
    res.status(400).json({ success: false, error: 'Identificador da ordem de serviço inválido.' });
    return;
  }

  try {
    const { data: order, error: findError } = await osSupabase
      .from('service_orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (findError) throw findError;
    if (!order) {
      res.status(404).json({ success: false, error: 'Ordem de serviço não encontrada.' });
      return;
    }
    if (!canManageOrder(req, order as ServiceOrderRecord)) {
      res.status(403).json({ success: false, error: 'Você não possui permissão para excluir esta ordem de serviço.' });
      return;
    }

    const driveFile = await findOriginalDriveFile(order as ServiceOrderRecord).catch(error => {
      console.warn('[service-orders] PDF do Drive não localizado antes da exclusão:', error);
      return null;
    });

    const { error: deleteError } = await osSupabase
      .from('service_orders')
      .delete()
      .eq('id', id);
    if (deleteError) throw deleteError;

    if (order.pdf_filename) {
      await unlink(localPdfPath(order.pdf_filename)).catch(() => undefined);
    }

    if (driveFile?.file_id) {
      await driveCommand(['delete', driveFile.file_id]).catch(error => {
        console.warn('[service-orders] Registro excluído, mas o PDF não pôde ser removido do Drive:', error);
      });
    }

    res.json({ success: true, message: 'Ordem de serviço excluída com sucesso.' });
  } catch (error) {
    orderError(res, error, 'Não foi possível excluir a ordem de serviço.');
  }
});

export default router;
