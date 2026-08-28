import { createClient } from '@supabase/supabase-js';
import { Router, Response } from 'express';
import { execFile } from 'child_process';
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

const osSupabaseUrl = process.env.OS_SUPABASE_URL || 'https://oiaykixldlfhlfzsuhfv.supabase.co';
const osSupabaseKey = process.env.OS_SUPABASE_ANON_KEY || 'sb_publishable_QN_vMYvBLHfmso9xanU4gg_K_SLcFxm';
const serviceOrderPdfDirectory = path.resolve(process.cwd(), 'data', 'service-orders');

const osSupabase = createClient(osSupabaseUrl, osSupabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

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
  if (req.user?.role === 'admin') return true;
  return normalizedName(technicianForOrder(order)) === normalizedName(req.user?.name);
}

function orderError(res: Response, error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message : fallback;
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

  const localVenv = process.platform === 'win32'
    ? path.resolve(process.cwd(), '.venv', 'Scripts', 'python.exe')
    : path.resolve(process.cwd(), '.venv', 'bin', 'python');
  if (existsSync(localVenv)) return { command: localVenv, prefixArgs: [] };
  return process.platform === 'win32'
    ? { command: 'py', prefixArgs: ['-3'] }
    : { command: 'python3', prefixArgs: [] };
}

function parseScriptResult(stdout: string): any {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}

async function runPythonService(scriptName: string, args: string[], timeout = 90_000): Promise<any> {
  const python = pythonInvocation();
  const scriptPath = path.resolve(process.cwd(), 'src', 'services', scriptName);
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
}

async function generateLocalPdf(orderId: string, filename: string, formData: Record<string, any>): Promise<string> {
  await mkdir(serviceOrderPdfDirectory, { recursive: true });
  const inputPath = path.join(serviceOrderPdfDirectory, `${safeFileSegment(orderId)}.json`);
  const outputPath = localPdfPath(filename);

  await writeFile(inputPath, JSON.stringify(formData), 'utf8');
  try {
    await runPythonService('service_order_pdf.py', [inputPath, outputPath]);
    if (!existsSync(outputPath)) throw new Error('O gerador PAT01-F2 não produziu o arquivo PDF.');
    return outputPath;
  } finally {
    await unlink(inputPath).catch(() => undefined);
  }
}

router.use(requireAuthentication);

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
  const serial = String(req.query.serial || '').trim();
  if (serial.length < 2 || serial.length > 80) {
    res.status(400).json({ success: false, error: 'Informe ao menos dois caracteres do número de série.' });
    return;
  }

  try {
    const fields = 'id, serial_number, equipment, brand, model, tag, client';
    let { data, error } = await osSupabase
      .from('equipments')
      .select(fields)
      .ilike('serial_number', serial)
      .limit(1);

    if (!error && (!data || data.length === 0)) {
      const escapedSerial = serial.replace(/[%_]/g, value => `\\${value}`);
      const fallback = await osSupabase
        .from('equipments')
        .select(fields)
        .ilike('serial_number', `%${escapedSerial}%`)
        .limit(1);
      data = fallback.data;
      error = fallback.error;
    }

    if (error) throw error;
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, equipment: data?.[0] || null });
  } catch (error) {
    orderError(res, error, 'Não foi possível consultar o catálogo de equipamentos.');
  }
});

router.post('/generate', async (req: AuthenticatedRequest, res: Response) => {
  const rawForm = req.body?.form_data;
  if (!rawForm || typeof rawForm !== 'object' || Array.isArray(rawForm)) {
    res.status(400).json({ success: false, error: 'Os dados da ordem de serviço são inválidos.' });
    return;
  }

  const formData: Record<string, any> = { ...rawForm };
  const clientName = String(formData.Cliente || '').trim();
  if (!clientName) {
    res.status(400).json({ success: false, error: 'Informe o cliente da ordem de serviço.' });
    return;
  }

  if (req.user?.role === 'technician') {
    formData.Nome_Tecnico = req.user.name;
  }

  const technicianName = String(formData.Nome_Tecnico || '').trim();
  if (!technicianName) {
    res.status(400).json({ success: false, error: 'Informe o técnico responsável.' });
    return;
  }

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
    }

    const signed = Boolean(formData.Assinatura_Tecnico || formData.Assinatura_Cliente);
    const orderReference = originalOrderReference(formData);
    formData.Atendimento = orderReference;
    const generatedFilename = `${signed ? 'SIGNED_OS' : 'OS'}_${orderReference}_${timestampForFilename()}.pdf`;
    const orderId = generatedFilename.replace(/\.pdf$/i, '');
    const pdfPath = await generateLocalPdf(orderId, generatedFilename, formData);
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
    if (!driveFile?.web_view_url) {
      res.status(410).json({
        success: false,
        error: 'O arquivo original desta OS não foi encontrado no Google Drive. Nenhum PDF foi recriado.'
      });
      return;
    }

    res.set('Cache-Control', 'private, no-store');
    res.redirect(302, driveFile.web_view_url);
  } catch (error) {
    orderError(res, error, 'Não foi possível localizar o PDF original da ordem de serviço no Google Drive.');
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
