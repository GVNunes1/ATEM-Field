import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Download,
  FileCheck2,
  FileText,
  LoaderCircle,
  Package,
  PenLine,
  RotateCcw,
  Search,
  Wrench,
  X
} from 'lucide-react';
import { AuthUser } from '../../types/auth';
import { downloadServiceOrderPdf, findEquipment, generateLocalServiceOrder, generateServiceOrder } from './serviceOrdersApi';
import { SignaturePad } from './SignaturePad';
import { ServiceOrder, ServiceOrderFormData, ServiceOrderPart, ServiceOrderToastType } from './types';

interface ServiceOrderFormProps {
  currentUser: AuthUser;
  initialOrder: ServiceOrder | null;
  onBack: () => void;
  notify: (message: string, type: ServiceOrderToastType) => void;
}

const emptyParts = (): ServiceOrderPart[] => Array.from({ length: 4 }, () => ({
  quantidade: '', codigo: '', nome: '', aplicado: ''
}));

function defaultForm(currentUser: AuthUser): ServiceOrderFormData {
  return {
    Atendimento: '',
    Cliente: '',
    Fone: '',
    Endereco: '',
    Contato: '',
    Setor_Contato: '',
    Email: '',
    Equipamento: '',
    Marca: '',
    Modelo: '',
    Patrimonio: '',
    Serie: '',
    Setor_Equipamento: '',
    Data: new Date().toLocaleDateString('pt-BR'),
    Hora_Chegada: '',
    Hora_Saida: '',
    Defeito_Reclamado: '',
    Defeito_Constatado: '',
    Causas: '',
    Descricao_Servicos: '',
    Servico_Concluido: '',
    Tensao_Adequada: '',
    Tensao_Volts: '',
    Tomada_Adequada: '',
    Pressao_Adequada: '',
    Pressao_Valor: '',
    Umidade_Rede: '',
    Valvula_Reguladora: '',
    Observacoes: '',
    Pecas: emptyParts(),
    Nome_Tecnico: currentUser.role === 'technician' ? currentUser.name : '',
    Nome_Cliente: '',
    Assinatura_Tecnico: '',
    Assinatura_Cliente: ''
  };
}

function formFromOrder(order: ServiceOrder, currentUser: AuthUser): ServiceOrderFormData {
  return {
    ...defaultForm(currentUser),
    ...(order.form_data || {}),
    Pecas: order.form_data?.Pecas?.length ? order.form_data.Pecas : emptyParts(),
    Atendimento: order.form_data?.Atendimento || order.os_number || '',
    Cliente: order.form_data?.Cliente || order.client_name || '',
    Serie: order.form_data?.Serie || order.serial_number || '',
    Equipamento: order.form_data?.Equipamento || order.equipment_name || '',
    Nome_Tecnico: currentUser.role === 'technician'
      ? currentUser.name
      : order.form_data?.Nome_Tecnico || order.technician_name || '',
    Data: order.form_data?.Data || order.service_date || new Date().toLocaleDateString('pt-BR'),
    _original_filename: order.pdf_filename,
    _original_id: order.id
  };
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  readOnly?: boolean;
  className?: string;
  onBlur?: () => void;
}

function Field({ id, label, value, onChange, placeholder, type = 'text', required, readOnly, className, onBlur }: FieldProps) {
  return (
    <div className={`os-form-field${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        readOnly={readOnly}
        onBlur={onBlur}
      />
    </div>
  );
}

interface TextAreaFieldProps extends Omit<FieldProps, 'type' | 'onBlur'> {
  rows?: number;
}

function TextAreaField({ id, label, value, onChange, placeholder, required, className, rows = 3 }: TextAreaFieldProps) {
  return (
    <div className={`os-form-field${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      <textarea id={id} rows={rows} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} required={required} />
    </div>
  );
}

interface FormSectionProps {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  description: string;
  children: React.ReactNode;
}

function FormSection({ icon: Icon, title, description, children }: FormSectionProps) {
  return (
    <section className="os-form-section">
      <div className="os-form-section-heading">
        <span><Icon size={18} /></span>
        <div><h3>{title}</h3><p>{description}</p></div>
      </div>
      {children}
    </section>
  );
}

interface ChoiceProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  extra?: React.ReactNode;
}

function Choice({ label, value, onChange, extra }: ChoiceProps) {
  return (
    <div className="os-choice-field">
      <div><strong>{label}</strong>{value && <button type="button" onClick={() => onChange('')} aria-label={`Limpar ${label}`}><X size={14} /></button>}</div>
      <div className="os-choice-buttons">
        <button type="button" className={value === 'Sim' ? 'is-yes' : ''} onClick={() => onChange(value === 'Sim' ? '' : 'Sim')}>Sim</button>
        <button type="button" className={value === 'Não' ? 'is-no' : ''} onClick={() => onChange(value === 'Não' ? '' : 'Não')}>Não</button>
      </div>
      {extra}
    </div>
  );
}

export function ServiceOrderForm({ currentUser, initialOrder, onBack, notify }: ServiceOrderFormProps) {
  const draftKey = useMemo(() => `atem.field.service-order.draft.${currentUser.id}`, [currentUser.id]);
  const [formData, setFormData] = useState<ServiceOrderFormData>(() => {
    if (initialOrder) return formFromOrder(initialOrder, currentUser);
    try {
      const draft = localStorage.getItem(draftKey);
      return draft ? { ...defaultForm(currentUser), ...JSON.parse(draft) } : defaultForm(currentUser);
    } catch {
      return defaultForm(currentUser);
    }
  });
  const [generating, setGenerating] = useState(false);
  const [searchingEquipment, setSearchingEquipment] = useState(false);
  const [equipmentResult, setEquipmentResult] = useState<'found' | 'missing' | ''>('');
  const [generatedOrder, setGeneratedOrder] = useState<ServiceOrder | null>(null);
  const [generatedDriveWarning, setGeneratedDriveWarning] = useState('');
  const [localOnlyNotice, setLocalOnlyNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    if (!initialOrder && dirty) {
      try { localStorage.setItem(draftKey, JSON.stringify(formData)); } catch { /* Storage can be unavailable. */ }
    }
  }, [draftKey, dirty, formData, initialOrder]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const update = (field: keyof ServiceOrderFormData, value: unknown) => {
    setFormData(previous => ({ ...previous, [field]: value }));
    setDirty(true);
    if ((field === 'Cliente' || field === 'Nome_Tecnico') && String(value || '').trim()) setValidationError('');
  };

  const updatePart = (index: number, field: keyof ServiceOrderPart, value: string) => {
    setFormData(previous => ({
      ...previous,
      Pecas: previous.Pecas.map((part, partIndex) => partIndex === index ? { ...part, [field]: value } : part)
    }));
    setDirty(true);
  };

  const lookupEquipment = async () => {
    const serial = stringValue(formData.Serie).trim();
    if (serial.length < 2) return;
    setSearchingEquipment(true);
    setEquipmentResult('');
    try {
      const equipment = await findEquipment(serial);
      if (!equipment) {
        setEquipmentResult('missing');
        notify('Número de série não encontrado; os dados podem ser preenchidos manualmente.', 'info');
        return;
      }
      setFormData(previous => ({
        ...previous,
        Cliente: equipment.client || previous.Cliente,
        Equipamento: equipment.equipment || previous.Equipamento,
        Marca: equipment.brand || previous.Marca,
        Modelo: equipment.model || previous.Modelo,
        Patrimonio: equipment.tag || previous.Patrimonio,
        Serie: equipment.serial_number || previous.Serie
      }));
      setEquipmentResult('found');
      setDirty(true);
      notify(`Equipamento encontrado: ${equipment.equipment || equipment.model || equipment.serial_number}`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Falha ao consultar o equipamento.', 'error');
    } finally {
      setSearchingEquipment(false);
    }
  };

  const clearForm = () => {
    if (!window.confirm('Limpar todos os campos desta ordem de serviço?')) return;
    setFormData(defaultForm(currentUser));
    setEquipmentResult('');
    setGeneratedOrder(null);
    setGeneratedDriveWarning('');
    setLocalOnlyNotice('');
    setDirty(false);
    try { localStorage.removeItem(draftKey); } catch { /* Ignore storage errors. */ }
    notify('Formulário limpo.', 'info');
  };

  const backSafely = () => {
    if (dirty && !window.confirm('Há alterações ainda não geradas. Deseja sair mesmo assim?')) return;
    onBack();
  };

  const validateRequiredFields = (): boolean => {
    if (!formData.Cliente.trim()) {
      setValidationError('Informe o cliente antes de gerar a OS.');
      document.getElementById('os-client')?.focus();
      return false;
    }
    if (!formData.Nome_Tecnico.trim()) {
      setValidationError('Informe o técnico responsável antes de gerar a OS.');
      document.getElementById('os-technician')?.focus();
      return false;
    }
    setValidationError('');
    return true;
  };

  const downloadLocalOnly = async (saveFailure?: string) => {
    if (!validateRequiredFields()) return;
    setGenerating(true);
    setGeneratedOrder(null);
    setGeneratedDriveWarning('');
    try {
      await generateLocalServiceOrder(formData);
      const notice = saveFailure
        ? `PDF baixado localmente. A OS não foi salva no histórico nem no Drive. Falha no registro: ${saveFailure}`
        : 'PDF baixado localmente. A OS não foi salva no histórico nem no Drive.';
      setLocalOnlyNotice(notice);
      notify(notice, 'info');
    } catch (error) {
      const localError = error instanceof Error ? error.message : 'Não foi possível gerar o PDF local.';
      notify(saveFailure ? `Falha ao salvar: ${saveFailure}. Falha no download local: ${localError}` : localError, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateRequiredFields()) return;

    setLocalOnlyNotice('');
    setGeneratedOrder(null);
    setGeneratedDriveWarning('');
    setGenerating(true);
    notify('Gerando o PDF e registrando a ordem de serviço…', 'info');
    try {
      const result = await generateServiceOrder(formData);
      setGeneratedOrder(result.order);
      setGeneratedDriveWarning(result.driveUploaded ? '' : result.warning || 'O envio ao Google Drive ficou pendente.');
      setDirty(false);
      try { localStorage.removeItem(draftKey); } catch { /* Ignore storage errors. */ }
      try {
        await downloadServiceOrderPdf(
          result.order.id,
          result.order.pdf_filename,
          result.downloadUrl || result.order.pdf_url
        );
        notify(
          result.driveUploaded
            ? 'Ordem de serviço gerada, salva e baixada com sucesso.'
            : result.warning || 'PDF gerado e baixado. O envio ao Google Drive ficou pendente.',
          result.driveUploaded ? 'success' : 'info'
        );
      } catch (downloadError) {
        notify(downloadError instanceof Error ? downloadError.message : 'A OS foi gerada, mas o download não iniciou.', 'error');
      }
    } catch (error) {
      const saveFailure = error instanceof Error ? error.message : 'Erro inesperado ao salvar a ordem de serviço.';
      // A failed Drive/Supabase registration must not prevent the technician from
      // taking the finished PDF with them. The form and draft remain available.
      await downloadLocalOnly(saveFailure);
    } finally {
      setGenerating(false);
    }
  };

  const downloadGeneratedOrder = async () => {
    if (!generatedOrder) return;
    try {
      await downloadServiceOrderPdf(generatedOrder.id, generatedOrder.pdf_filename, generatedOrder.pdf_url);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível baixar o PDF.', 'error');
    }
  };

  return (
    <form className="os-form-page" onSubmit={submit}>
      <div className="os-form-toolbar">
        <button type="button" className="os-button os-button--quiet" onClick={backSafely}>
          <ArrowLeft size={17} /> Voltar às ordens
        </button>
        {initialOrder && <span className="os-editing-badge"><FileText size={15} /> Editando {initialOrder.os_number || initialOrder.id}</span>}
      </div>

      {validationError && <div className="os-inline-alert" role="alert">{validationError}</div>}

      <div className="os-form-card">
        <FormSection icon={FileText} title="1. Dados do atendimento" description="Identificação da OS, data e horários">
          <div className="os-form-grid os-form-grid--4">
            <Field id="os-number" label="Nº Atendimento / OS" value={stringValue(formData.Atendimento)} onChange={value => update('Atendimento', value)} placeholder="OS-12345" />
            <Field id="os-date" label="Data" value={stringValue(formData.Data)} onChange={value => update('Data', value)} placeholder="DD/MM/AAAA" />
            <Field id="os-arrival" label="Hora de chegada" type="time" value={stringValue(formData.Hora_Chegada)} onChange={value => update('Hora_Chegada', value)} />
            <Field id="os-departure" label="Hora de saída" type="time" value={stringValue(formData.Hora_Saida)} onChange={value => update('Hora_Saida', value)} />
          </div>
        </FormSection>

        <FormSection icon={Building2} title="2. Identificação do cliente" description="Hospital, clínica e contato responsável">
          <div className="os-form-grid os-form-grid--3">
            <Field id="os-client" label="Cliente / Razão Social" required value={formData.Cliente} onChange={value => update('Cliente', value)} className="os-field-span-2" placeholder="Nome da instituição" />
            <Field id="os-phone" label="Telefone" type="tel" value={stringValue(formData.Fone)} onChange={value => update('Fone', value)} placeholder="(00) 00000-0000" />
            <Field id="os-address" label="Endereço" value={stringValue(formData.Endereco)} onChange={value => update('Endereco', value)} className="os-field-span-3" placeholder="Logradouro, número e cidade" />
            <Field id="os-contact" label="Contato no local" value={stringValue(formData.Contato)} onChange={value => update('Contato', value)} />
            <Field id="os-contact-sector" label="Setor do contato" value={stringValue(formData.Setor_Contato)} onChange={value => update('Setor_Contato', value)} />
            <Field id="os-email" label="E-mail" type="email" value={stringValue(formData.Email)} onChange={value => update('Email', value)} />
          </div>
        </FormSection>

        <FormSection icon={Wrench} title="3. Equipamento" description="A busca pelo número de série preenche o catálogo automaticamente">
          <div className="os-form-grid os-form-grid--3">
            <div className="os-form-field">
              <label htmlFor="os-serial">Nº de Série</label>
              <div className={`os-input-action${equipmentResult ? ` is-${equipmentResult}` : ''}`}>
                <input id="os-serial" value={stringValue(formData.Serie)} onChange={event => { update('Serie', event.target.value); setEquipmentResult(''); }} onBlur={() => void lookupEquipment()} placeholder="Digite a série" />
                <button type="button" onClick={() => void lookupEquipment()} disabled={searchingEquipment} aria-label="Buscar equipamento pela série">
                  {searchingEquipment ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}
                </button>
              </div>
            </div>
            <Field id="os-equipment" label="Equipamento" value={stringValue(formData.Equipamento)} onChange={value => update('Equipamento', value)} />
            <Field id="os-brand" label="Marca / Fabricante" value={stringValue(formData.Marca)} onChange={value => update('Marca', value)} />
            <Field id="os-model" label="Modelo" value={stringValue(formData.Modelo)} onChange={value => update('Modelo', value)} />
            <Field id="os-tag" label="TAG / Patrimônio" value={stringValue(formData.Patrimonio)} onChange={value => update('Patrimonio', value)} />
            <Field id="os-sector" label="Setor do equipamento" value={stringValue(formData.Setor_Equipamento)} onChange={value => update('Setor_Equipamento', value)} />
          </div>
        </FormSection>

        <FormSection icon={AlertTriangle} title="4. Descrição dos problemas" description="Relato do cliente e diagnóstico técnico">
          <div className="os-form-grid">
            <TextAreaField id="os-reported-defect" label="Defeito reclamado" value={stringValue(formData.Defeito_Reclamado)} onChange={value => update('Defeito_Reclamado', value)} placeholder="Relato do cliente" />
            <TextAreaField id="os-found-defect" label="Defeito constatado" value={stringValue(formData.Defeito_Constatado)} onChange={value => update('Defeito_Constatado', value)} placeholder="Diagnóstico do técnico" />
            <Field id="os-causes" label="Causas" value={stringValue(formData.Causas)} onChange={value => update('Causas', value)} placeholder="Desgaste, sobretensão, impacto…" />
          </div>
        </FormSection>

        <FormSection icon={FileCheck2} title="5. Serviços executados" description="Procedimentos técnicos realizados">
          <TextAreaField id="os-services" label="Descrição dos serviços" rows={5} value={stringValue(formData.Descricao_Servicos || formData.Descricao_Servico)} onChange={value => update('Descricao_Servicos', value)} placeholder="Descreva os procedimentos realizados" />
        </FormSection>

        <FormSection icon={Package} title="6. Peças e acessórios" description="Componentes utilizados ou orçados">
          <div className="os-table-wrap">
            <table className="os-parts-table">
              <thead><tr><th>Qtd.</th><th>Código</th><th>Descrição da peça</th><th>Aplicado</th></tr></thead>
              <tbody>
                {formData.Pecas.map((part, index) => (
                  <tr key={index}>
                    <td><input aria-label={`Quantidade da peça ${index + 1}`} value={part.quantidade} onChange={event => updatePart(index, 'quantidade', event.target.value)} /></td>
                    <td><input aria-label={`Código da peça ${index + 1}`} value={part.codigo} onChange={event => updatePart(index, 'codigo', event.target.value)} /></td>
                    <td><input aria-label={`Descrição da peça ${index + 1}`} value={part.nome} onChange={event => updatePart(index, 'nome', event.target.value)} /></td>
                    <td><select aria-label={`Aplicação da peça ${index + 1}`} value={part.aplicado} onChange={event => updatePart(index, 'aplicado', event.target.value)}><option value="">Não informado</option><option value="Sim">Sim</option><option value="Não">Não</option></select></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>

        <FormSection icon={Activity} title="7. Medições elétricas e pneumáticas" description="Verificações opcionais de infraestrutura e segurança">
          <div className="os-choice-grid">
            <Choice label="Tensão adequada?" value={stringValue(formData.Tensao_Adequada)} onChange={value => update('Tensao_Adequada', value)} extra={<input aria-label="Valor da tensão" value={stringValue(formData.Tensao_Volts)} onChange={event => update('Tensao_Volts', event.target.value)} placeholder="Ex.: 220 V" />} />
            <Choice label="Tomada adequada?" value={stringValue(formData.Tomada_Adequada)} onChange={value => update('Tomada_Adequada', value)} />
            <Choice label="Pressão adequada?" value={stringValue(formData.Pressao_Adequada)} onChange={value => update('Pressao_Adequada', value)} extra={<input aria-label="Valor da pressão" value={stringValue(formData.Pressao_Valor)} onChange={event => update('Pressao_Valor', event.target.value)} placeholder="kgf/cm²" />} />
            <Choice label="Umidade na rede?" value={stringValue(formData.Umidade_Rede)} onChange={value => update('Umidade_Rede', value)} />
            <Choice label="Válvula reguladora?" value={stringValue(formData.Valvula_Reguladora)} onChange={value => update('Valvula_Reguladora', value)} />
          </div>
        </FormSection>

        <FormSection icon={CheckCircle2} title="8. Conclusão" description="Situação final e observações do atendimento">
          <div className="os-form-grid">
            <Choice label="Serviço concluído?" value={stringValue(formData.Servico_Concluido)} onChange={value => update('Servico_Concluido', value)} />
            <TextAreaField id="os-notes" label="Observações técnicas" value={stringValue(formData.Observacoes || formData.Observacoes_Tecnicas)} onChange={value => update('Observacoes', value)} />
          </div>
        </FormSection>

        <FormSection icon={PenLine} title="9. Identificação e assinaturas" description="Assine com o dedo, caneta digital ou mouse">
          <div className="os-signature-grid">
            <div>
              <Field id="os-technician" label="Técnico responsável" required readOnly={currentUser.role === 'technician'} value={formData.Nome_Tecnico} onChange={value => update('Nome_Tecnico', value)} />
              <SignaturePad id="os-technician-signature" label="Assinatura do técnico" hint="Valida a execução do atendimento" value={stringValue(formData.Assinatura_Tecnico)} onChange={value => update('Assinatura_Tecnico', value)} />
            </div>
            <div>
              <Field id="os-client-name" label="Responsável no cliente" value={stringValue(formData.Nome_Cliente)} onChange={value => update('Nome_Cliente', value)} />
              <SignaturePad id="os-client-signature" label="Assinatura do cliente" hint="Confirma o atendimento realizado" value={stringValue(formData.Assinatura_Cliente)} onChange={value => update('Assinatura_Cliente', value)} />
            </div>
          </div>
        </FormSection>

        <div className="os-form-actions">
          <button type="button" className="os-button os-button--danger-quiet" onClick={clearForm}><RotateCcw size={17} /> Limpar formulário</button>
          <button type="button" className="os-button os-button--secondary os-button--large" disabled={generating} onClick={() => void downloadLocalOnly()}>
            <Download size={18} /> Baixar somente PDF
          </button>
          <button type="submit" className="os-button os-button--primary os-button--large" disabled={generating}>
            {generating ? <LoaderCircle className="spin" size={19} /> : <FileCheck2 size={19} />}
            {generating ? 'Gerando PDF…' : formData.Assinatura_Tecnico || formData.Assinatura_Cliente ? 'Gerar e salvar como assinada' : initialOrder ? 'Atualizar PDF da OS' : 'Gerar PDF e salvar OS'}
          </button>
        </div>

        {localOnlyNotice && (
          <div className="os-download-success os-download-success--pending" role="status">
            <AlertTriangle size={20} />
            <span><strong>Download local concluído.</strong> {localOnlyNotice}</span>
          </div>
        )}

        {generatedOrder && (
          <div className={`os-download-success${generatedDriveWarning ? ' os-download-success--pending' : ''}`} role="status">
            {generatedDriveWarning ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
            <span>
              <strong>{generatedDriveWarning ? 'PDF pronto; Drive pendente.' : 'Documento pronto.'}</strong>{' '}
              {generatedDriveWarning || 'A ordem foi registrada no ATEM Field e salva no Google Drive.'}
            </span>
            <button type="button" className="os-button os-button--success" onClick={() => void downloadGeneratedOrder()}><Download size={17} /> Baixar PDF</button>
          </div>
        )}
      </div>
    </form>
  );
}
