import { createClient } from '@supabase/supabase-js';
import { Router, Response } from 'express';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
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
const osBackendUrl = (process.env.OS_BACKEND_URL || 'https://telegram-form-bot-3ajw.onrender.com').replace(/\/$/, '');
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
  const clean = value.trim();
  if (/^https?:\/\//i.test(clean)) return clean;
  if (clean.startsWith('/api/service-orders/')) return clean;
  return `${osBackendUrl}${clean.startsWith('/') ? clean : `/${clean}`}`;
}

function safeFileSegment(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'OS';
}

function timestampForFilename(): string {
  const now = new Date();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('');
  const time = [String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0'), String(now.getSeconds()).padStart(2, '0')].join('');
  return `${date}_${time}`;
}

function localPdfPath(filename: string): string {
  return path.join(serviceOrderPdfDirectory, path.basename(filename));
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

async function generateLocalPdf(orderId: string, filename: string, formData: Record<string, any>): Promise<string> {
  await mkdir(serviceOrderPdfDirectory, { recursive: true });
  const inputPath = path.join(serviceOrderPdfDirectory, `${safeFileSegment(orderId)}.json`);
  const outputPath = localPdfPath(filename);
  const scriptPath = path.resolve(process.cwd(), 'src', 'services', 'service_order_pdf.py');
  const python = pythonInvocation();

  await writeFile(inputPath, JSON.stringify(formData), 'utf8');
  try {
    const { stdout } = await execFileAsync(
      python.command,
      [...python.prefixArgs, scriptPath, inputPath, outputPath],
      { timeout: 90_000, maxBuffer: 1024 * 1024 }
    );
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const result = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
    if (!result?.success || !existsSync(outputPath)) {
      throw new Error(result?.error || 'O gerador local não produziu o arquivo PDF.');
    }
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
        pdf_url: normalizeDownloadUrl(order.pdf_url || (order.pdf_filename ? `/download/${order.pdf_filename}` : undefined))
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
    if (originalId) {
      const { data: originalOrder, error: originalError } = await osSupabase
        .from('service_orders')
        .select('*')
        .eq('id', originalId)
        .maybeSingle();

      if (originalError) throw originalError;
      if (originalOrder && !canManageOrder(req, originalOrder as ServiceOrderRecord)) {
        res.status(403).json({ success: false, error: 'Você não possui permissão para editar esta ordem de serviço.' });
        return;
      }
    }

    const signed = Boolean(formData.Assinatura_Tecnico || formData.Assinatura_Cliente);
    const orderReference = safeFileSegment(formData.Atendimento || formData.Serie || Date.now());
    const generatedFilename = `${signed ? 'SIGNED_OS' : 'OS'}_${orderReference}_${timestampForFilename()}.pdf`;
    const orderId = generatedFilename.replace(/\.pdf$/i, '');
    const downloadUrl = `/api/service-orders/${encodeURIComponent(orderId)}/pdf`;

    await generateLocalPdf(orderId, generatedFilename, formData);

    const order: ServiceOrderRecord = {
      id: orderId,
      os_number: String(formData.Atendimento || orderId),
      status: signed ? 'signed' : 'unsigned',
      client_name: clientName,
      serial_number: String(formData.Serie || ''),
      equipment_name: String(formData.Equipamento || ''),
      technician_name: technicianName,
      service_date: String(formData.Data || ''),
      form_data: formData,
      pdf_filename: generatedFilename || null,
      pdf_url: downloadUrl || null,
      updated_at: new Date().toISOString()
    };

    const { error: upsertError } = await osSupabase
      .from('service_orders')
      .upsert(order);
    if (upsertError) throw upsertError;

    if (originalId && originalId !== orderId) {
      const { error: deleteOriginalError } = await osSupabase
        .from('service_orders')
        .delete()
        .eq('id', originalId);
      if (deleteOriginalError) throw deleteOriginalError;
    }

    res.json({
      success: true,
      order,
      filename: generatedFilename,
      download_url: downloadUrl
    });
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

    const filename = safeFileSegment(order.pdf_filename || `${id}.pdf`).replace(/\.pdf$/i, '') + '.pdf';
    let filePath = localPdfPath(filename);
    if (!existsSync(filePath)) {
      filePath = await generateLocalPdf(id, filename, order.form_data || {});
    }

    res.set('Cache-Control', 'private, no-store');
    res.download(filePath, filename);
  } catch (error) {
    orderError(res, error, 'Não foi possível preparar o PDF da ordem de serviço.');
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

    const { error: deleteError } = await osSupabase
      .from('service_orders')
      .delete()
      .eq('id', id);
    if (deleteError) throw deleteError;

    if (order.pdf_filename) {
      await unlink(localPdfPath(order.pdf_filename)).catch(() => undefined);
    }

    if (order.pdf_filename && !String(order.pdf_url || '').startsWith('/api/service-orders/')) {
      void fetch(`${osBackendUrl}/delete_file/${encodeURIComponent(order.pdf_filename)}`).catch(error => {
        console.warn('[service-orders] PDF legado não removido:', error);
      });
    }

    res.json({ success: true, message: 'Ordem de serviço excluída com sucesso.' });
  } catch (error) {
    orderError(res, error, 'Não foi possível excluir a ordem de serviço.');
  }
});

export default router;
