import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Edit3,
  FileCheck2,
  FileClock,
  FilePenLine,
  FileText,
  FilterX,
  LoaderCircle,
  RefreshCw,
  Search,
  Trash2,
  X
} from 'lucide-react';
import { AuthUser } from '../../types/auth';
import { deleteServiceOrder, downloadServiceOrderPdf, listServiceOrders } from './serviceOrdersApi';
import { ServiceOrder, ServiceOrderToastType } from './types';

interface ServiceOrdersDashboardProps {
  currentUser: AuthUser;
  onOpenOrder: (order: ServiceOrder) => void;
  onNewOrder: () => void;
  notify: (message: string, type: ServiceOrderToastType) => void;
}

const PAGE_SIZE = 50;

function parsedOrderDate(order: ServiceOrder): { month: string; date: string } | null {
  const rawDate = order.service_date || order.form_data?.Data;
  if (rawDate) {
    const match = String(rawDate).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) return { month: `${match[3]}-${match[2]}`, date: `${match[3]}-${match[2]}-${match[1]}` };
  }

  const created = new Date(order.created_at);
  if (Number.isNaN(created.getTime())) return null;
  const year = created.getFullYear();
  const month = String(created.getMonth() + 1).padStart(2, '0');
  const day = String(created.getDate()).padStart(2, '0');
  return { month: `${year}-${month}`, date: `${year}-${month}-${day}` };
}

function orderClient(order: ServiceOrder): string {
  return String(order.client_name || order.form_data?.Cliente || 'Cliente não identificado').trim();
}

function orderDateLabel(order: ServiceOrder): string {
  return String(order.service_date || order.form_data?.Data || new Date(order.created_at).toLocaleDateString('pt-BR'));
}

export function ServiceOrdersDashboard({
  currentUser,
  onOpenOrder,
  onNewOrder,
  notify
}: ServiceOrdersDashboardProps) {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [status, setStatus] = useState<'unsigned' | 'signed'>('unsigned');
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState('');
  const [date, setDate] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  const loadOrders = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      setOrders(await listServiceOrders());
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Não foi possível carregar as ordens de serviço.';
      setError(message);
      if (!quiet) notify(message, 'error');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadOrders();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadOrders(true);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadOrders]);

  const counts = useMemo(() => ({
    unsigned: orders.filter(order => order.status === 'unsigned').length,
    signed: orders.filter(order => order.status === 'signed').length
  }), [orders]);

  const availableMonths = useMemo(() => {
    const formatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
    const values = new Map<string, string>();
    orders.forEach(order => {
      const parsed = parsedOrderDate(order);
      if (!parsed) return;
      const [year, monthValue] = parsed.month.split('-').map(Number);
      values.set(parsed.month, formatter.format(new Date(year, monthValue - 1, 1)));
    });
    return Array.from(values.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    return orders.filter(order => {
      if (order.status !== status) return false;
      const parsed = parsedOrderDate(order);
      if (month && parsed?.month !== month) return false;
      if (date && parsed?.date !== date) return false;
      if (!query) return true;
      return [
        orderClient(order),
        order.serial_number || order.form_data?.Serie,
        order.os_number || order.id,
        order.technician_name || order.form_data?.Nome_Tecnico,
        order.equipment_name || order.form_data?.Equipamento,
        orderDateLabel(order)
      ].some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query));
    });
  }, [date, month, orders, search, status]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const pagedOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const groupedOrders = useMemo(() => pagedOrders.reduce<Record<string, ServiceOrder[]>>((groups, order) => {
    const client = orderClient(order).toLocaleUpperCase('pt-BR');
    groups[client] ||= [];
    groups[client].push(order);
    return groups;
  }, {}), [pagedOrders]);
  const clients = Object.keys(groupedOrders).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  useEffect(() => {
    setPage(1);
  }, [date, month, search, status]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (!clients.length) return;
    setExpanded(previous => {
      if (Object.keys(previous).some(client => previous[client])) return previous;
      return { ...previous, [clients[0]]: true };
    });
  }, [clients.join('|')]);

  const clearFilters = () => {
    setSearch('');
    setMonth('');
    setDate('');
  };

  const handleDelete = async (order: ServiceOrder) => {
    if (!window.confirm(`Excluir definitivamente a ordem ${order.os_number || order.id}?`)) return;
    setDeletingId(order.id);
    try {
      await deleteServiceOrder(order.id);
      setOrders(previous => previous.filter(item => item.id !== order.id));
      notify('Ordem de serviço excluída com sucesso.', 'success');
    } catch (deleteError) {
      notify(deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir a ordem.', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = async (order: ServiceOrder) => {
    setDownloadingId(order.id);
    try {
      await downloadServiceOrderPdf(order.id, order.pdf_filename);
    } catch (downloadError) {
      notify(downloadError instanceof Error ? downloadError.message : 'Não foi possível baixar o PDF.', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const hasFilters = Boolean(search || month || date);

  return (
    <div className="os-dashboard">
      <div className="os-stat-grid" aria-label="Resumo das ordens de serviço">
        <div className="os-stat-card">
          <div><span>Total visível</span><strong>{orders.length.toLocaleString('pt-BR')}</strong></div>
          <span className="os-stat-icon os-stat-icon--blue"><FileText size={23} /></span>
        </div>
        <button
          type="button"
          className={`os-stat-card os-stat-card--button${status === 'unsigned' ? ' is-active' : ''}`}
          onClick={() => setStatus('unsigned')}
        >
          <div><span>Aguardando assinatura</span><strong>{counts.unsigned.toLocaleString('pt-BR')}</strong></div>
          <span className="os-stat-icon os-stat-icon--amber"><FileClock size={23} /></span>
        </button>
        <button
          type="button"
          className={`os-stat-card os-stat-card--button${status === 'signed' ? ' is-active' : ''}`}
          onClick={() => setStatus('signed')}
        >
          <div><span>Assinadas</span><strong>{counts.signed.toLocaleString('pt-BR')}</strong></div>
          <span className="os-stat-icon os-stat-icon--green"><FileCheck2 size={23} /></span>
        </button>
      </div>

      <section className="os-list-card" aria-labelledby="service-orders-list-title">
        <div className="os-list-heading">
          <div>
            <span className="os-eyebrow">{currentUser.role === 'admin' ? 'Operação completa' : 'Minhas ordens'}</span>
            <h3 id="service-orders-list-title">{status === 'unsigned' ? 'OS aguardando assinatura' : 'OS assinadas'}</h3>
          </div>
          <button type="button" className="os-button os-button--primary" onClick={onNewOrder}>
            <FilePenLine size={17} /> Nova OS
          </button>
        </div>

        <div className="os-filter-bar">
          <label className="os-search-field">
            <span className="sr-only">Buscar ordens de serviço</span>
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Cliente, série, técnico ou OS"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca"><X size={16} /></button>
            )}
          </label>
          <label className="os-filter-field">
            <span>Mês</span>
            <select value={month} onChange={event => { setMonth(event.target.value); if (event.target.value) setDate(''); }}>
              <option value="">Todos</option>
              {availableMonths.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="os-filter-field">
            <span>Data exata</span>
            <input type="date" value={date} onChange={event => { setDate(event.target.value); if (event.target.value) setMonth(''); }} />
          </label>
          {hasFilters && (
            <button type="button" className="os-button os-button--quiet" onClick={clearFilters}>
              <FilterX size={17} /> Limpar
            </button>
          )}
          <button type="button" className="os-icon-button" onClick={() => void loadOrders()} disabled={loading} aria-label="Atualizar lista">
            <RefreshCw size={18} className={loading ? 'spin' : undefined} />
          </button>
        </div>

        {error && (
          <div className="os-inline-alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadOrders()}>Tentar novamente</button>
          </div>
        )}

        {loading ? (
          <div className="os-empty-state" aria-live="polite">
            <LoaderCircle className="spin" size={30} />
            <strong>Carregando ordens de serviço</strong>
            <p>Consultando os relatórios vinculados ao seu perfil.</p>
          </div>
        ) : clients.length === 0 ? (
          <div className="os-empty-state">
            <FileText size={34} />
            <strong>Nenhuma ordem encontrada</strong>
            <p>{hasFilters ? 'Ajuste ou limpe os filtros para ampliar a busca.' : 'Crie uma nova OS para iniciar o histórico.'}</p>
            {hasFilters ? (
              <button type="button" className="os-button os-button--secondary" onClick={clearFilters}>Limpar filtros</button>
            ) : (
              <button type="button" className="os-button os-button--primary" onClick={onNewOrder}>Criar nova OS</button>
            )}
          </div>
        ) : (
          <div className="os-client-list">
            {clients.map(client => {
              const isExpanded = Boolean(expanded[client]);
              return (
                <section key={client} className="os-client-group">
                  <button
                    type="button"
                    className="os-client-toggle"
                    onClick={() => setExpanded(previous => ({ ...previous, [client]: !isExpanded }))}
                    aria-expanded={isExpanded}
                  >
                    <span className="os-client-icon"><Building2 size={18} /></span>
                    <span><strong>{client}</strong><small>{groupedOrders[client].length} relatório(s) nesta página</small></span>
                    <ChevronDown size={19} className={isExpanded ? 'is-rotated' : undefined} />
                  </button>
                  {isExpanded && (
                    <div className="os-order-list">
                      {groupedOrders[client].map(order => {
                        const signed = order.status === 'signed';
                        return (
                          <article key={order.id} className="os-order-row">
                            <span className={`os-order-icon${signed ? ' os-order-icon--signed' : ''}`}>
                              {signed ? <CheckCircle2 size={20} /> : <FileText size={20} />}
                            </span>
                            <div className="os-order-main">
                              <div className="os-order-title">
                                <strong>{order.os_number || order.id}</strong>
                                <span className={`os-status-badge${signed ? ' os-status-badge--signed' : ''}`}>
                                  {signed ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
                                  {signed ? 'Assinada' : 'Aguardando assinatura'}
                                </span>
                              </div>
                              <p>{order.equipment_name || String(order.form_data?.Equipamento || 'Equipamento não informado')}</p>
                              <div className="os-order-meta">
                                <span className="os-technical-id">Série {order.serial_number || String(order.form_data?.Serie || 'N/A')}</span>
                                <span><Calendar size={14} /> {orderDateLabel(order)}</span>
                                <span>Técnico: {order.technician_name || String(order.form_data?.Nome_Tecnico || 'Não informado')}</span>
                              </div>
                            </div>
                            <div className="os-order-actions">
                              <button type="button" className="os-button os-button--quiet" onClick={() => void handleDownload(order)} disabled={downloadingId === order.id}>
                                {downloadingId === order.id ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} Baixar
                              </button>
                              {!signed && (
                                <button type="button" className="os-button os-button--secondary" onClick={() => onOpenOrder(order)}>
                                  <Edit3 size={16} /> Editar / assinar
                                </button>
                              )}
                              <button
                                type="button"
                                className="os-icon-button os-icon-button--danger"
                                onClick={() => void handleDelete(order)}
                                disabled={deletingId === order.id}
                                aria-label={`Excluir ${order.os_number || order.id}`}
                              >
                                {deletingId === order.id ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {!loading && filteredOrders.length > 0 && (
          <div className="os-pagination">
            <span>
              {((page - 1) * PAGE_SIZE + 1).toLocaleString('pt-BR')}–{Math.min(page * PAGE_SIZE, filteredOrders.length).toLocaleString('pt-BR')} de {filteredOrders.length.toLocaleString('pt-BR')}
            </span>
            <div>
              <button type="button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page === 1} aria-label="Página anterior"><ChevronLeft size={17} /></button>
              <strong>Página {page} de {totalPages}</strong>
              <button type="button" onClick={() => setPage(value => Math.min(totalPages, value + 1))} disabled={page === totalPages} aria-label="Próxima página"><ChevronRight size={17} /></button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
