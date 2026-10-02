import { apiUrl, authenticatedFetch, safeFetchJson } from '../../lib/api';
import { EquipmentRecord, ServiceOrder, ServiceOrderFormData } from './types';

export async function listServiceOrders(): Promise<ServiceOrder[]> {
  const data = await safeFetchJson('/api/service-orders', { cache: 'no-store' });
  if (!data.success) throw new Error(data.error || 'Não foi possível carregar as ordens de serviço.');
  return data.orders || [];
}

export async function findEquipment(serial: string): Promise<EquipmentRecord | null> {
  const data = await safeFetchJson(`/api/service-orders/equipment?serial=${encodeURIComponent(serial)}`, {
    cache: 'no-store'
  });
  if (!data.success) throw new Error(data.error || 'Não foi possível consultar o equipamento.');
  return data.equipment || null;
}

export async function generateServiceOrder(formData: ServiceOrderFormData): Promise<{
  order: ServiceOrder;
  downloadUrl?: string;
  driveUploaded: boolean;
  warning?: string;
}> {
  const data = await safeFetchJson('/api/service-orders/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ form_data: formData })
  });
  if (!data.success) throw new Error(data.error || 'Não foi possível gerar a ordem de serviço.');
  return {
    order: data.order,
    downloadUrl: data.download_url,
    driveUploaded: data.drive_uploaded !== false,
    warning: typeof data.warning === 'string' && data.warning.trim() ? data.warning.trim() : undefined
  };
}

export async function deleteServiceOrder(id: string): Promise<void> {
  const data = await safeFetchJson(`/api/service-orders/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  if (!data.success) throw new Error(data.error || 'Não foi possível excluir a ordem de serviço.');
}

export async function generateLocalServiceOrder(formData: ServiceOrderFormData): Promise<void> {
  const response = await authenticatedFetch(apiUrl('/api/service-orders/generate-local'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ form_data: formData })
  });
  await savePdfResponse(response, 'Ordem_de_servico.pdf');
}

function openExternalPdf(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function downloadServiceOrderPdf(id: string, suggestedFilename?: string, sourceUrl?: string): Promise<void> {
  if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
    openExternalPdf(sourceUrl);
    return;
  }

  const response = await authenticatedFetch(apiUrl(`/api/service-orders/${encodeURIComponent(id)}/pdf`));
  await savePdfResponse(response, suggestedFilename || `${id}.pdf`);
}

async function savePdfResponse(response: Response, suggestedFilename: string): Promise<void> {
  if (!response.ok) {
    let message = 'Não foi possível baixar o PDF da ordem de serviço.';
    try {
      const data = await response.json();
      if (data.error) message = data.error;
    } catch {
      // Keep the recovery-oriented fallback message.
    }
    throw new Error(message);
  }

  if (!/^application\/pdf\b/i.test(response.headers.get('content-type') || '')) {
    throw new Error('A API não retornou um PDF válido. Verifique a conexão com o backend.');
  }

  const disposition = response.headers.get('content-disposition') || '';
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const simpleName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const filename = encodedName ? decodeURIComponent(encodedName) : simpleName || suggestedFilename;
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}
