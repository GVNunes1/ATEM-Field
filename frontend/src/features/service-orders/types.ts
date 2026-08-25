export interface EquipmentRecord {
  id?: string;
  serial_number: string;
  equipment?: string;
  brand?: string;
  model?: string;
  tag?: string;
  client?: string;
}

export interface ServiceOrderPart {
  quantidade: string;
  codigo: string;
  nome: string;
  aplicado: string;
}

export interface ServiceOrderFormData {
  Atendimento?: string;
  Cliente: string;
  Fone?: string;
  Endereco?: string;
  Contato?: string;
  Setor_Contato?: string;
  Email?: string;
  Equipamento?: string;
  Marca?: string;
  Modelo?: string;
  Patrimonio?: string;
  Serie?: string;
  Setor_Equipamento?: string;
  Data?: string;
  Hora_Chegada?: string;
  Hora_Saida?: string;
  Hora_Inicio_Servico?: string;
  Hora_Termino_Servico?: string;
  Defeito_Reclamado?: string;
  Defeito_Constatado?: string;
  Causas?: string;
  Descricao_Servicos?: string;
  Descricao_Servico?: string;
  Servico_Concluido?: string;
  Tensao_Adequada?: string;
  Tensao_Volts?: string;
  Tomada_Adequada?: string;
  Pressao_Adequada?: string;
  Pressao_Valor?: string;
  Umidade_Rede?: string;
  Valvula_Reguladora?: string;
  Observacoes?: string;
  Observacoes_Tecnicas?: string;
  Pecas: ServiceOrderPart[];
  Nome_Tecnico: string;
  Nome_Cliente?: string;
  Assinatura_Tecnico?: string;
  Assinatura_Cliente?: string;
  _original_filename?: string;
  _original_id?: string;
  [key: string]: unknown;
}

export interface ServiceOrder {
  id: string;
  os_number?: string;
  status: 'unsigned' | 'signed';
  client_name?: string;
  serial_number?: string;
  equipment_name?: string;
  technician_name?: string;
  service_date?: string;
  form_data: ServiceOrderFormData;
  pdf_filename?: string;
  pdf_url?: string;
  created_at: string;
  updated_at?: string;
}

export type ServiceOrderToastType = 'success' | 'error' | 'info';
