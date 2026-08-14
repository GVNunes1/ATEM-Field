import fs from 'fs';
import path from 'path';

const dataFilePath = path.resolve(__dirname, '../../data/db.json');
const dataDir = path.dirname(dataFilePath);

export interface DBData {
  technicians: any[];
  equipment_categories: any[];
  test_templates: any[];
  analyzers: any[];
  appointments: any[];
  appointment_equipments: any[];
  reservations: any[];
  notification_logs: any[];
}

let store: DBData = {
  technicians: [],
  equipment_categories: [],
  test_templates: [],
  analyzers: [],
  appointments: [],
  appointment_equipments: [],
  reservations: [],
  notification_logs: []
};

function saveStore() {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(dataFilePath, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving DB to file:', err);
  }
}

function loadStore() {
  try {
    if (fs.existsSync(dataFilePath)) {
      const raw = fs.readFileSync(dataFilePath, 'utf-8');
      store = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error loading DB file, starting fresh:', err);
  }
}

export function resetDatabaseData() {
  store.technicians = [];
  store.appointments = [];
  store.appointment_equipments = [];
  store.reservations = [];
  store.notification_logs = [];
  saveStore();
}

export function initDatabase() {
  loadStore();

  // Equipment categories
  if (store.equipment_categories.length === 0) {
    store.equipment_categories = [
      { id: 1, name: 'Desfibrilador / Cardioversor', description: 'Desfibriladores bipásicos, DEA e cardioversores de emergência e UTI' },
      { id: 2, name: 'Monitor Multiparamétrico', description: 'Monitores de sinais vitais (ECG, SpO2, NIBP, Temp, Capnografia)' },
      { id: 3, name: 'Ventilador Pulmonar', description: 'Ventiladores de UTI e Transporte de alta complexidade' },
      { id: 4, name: 'Bomba de Infusão', description: 'Bombas peristálticas de infusão contínua e seringa' },
      { id: 5, name: 'Ultrassom Diagnóstico', description: 'Sistemas de ultrassonografia geral, cardio e vascular' },
      { id: 6, name: 'Autoclave / Esterilização', description: 'Equipamentos de esterilização e autoclaves hospitalares' },
      { id: 7, name: 'Bisturi Eletrônico', description: 'Unidades eletrocirúrgicas e geradores de radiofrequência' }
    ];
  }

  // Test templates
  if (store.test_templates.length === 0) {
    store.test_templates = [
      {
        id: 1,
        category_id: 1,
        analyzer_type: 'Analisador de Desfibrilador',
        required_parameters: JSON.stringify([
          'Energia de Choque Selecionada vs Entregue (Joules)',
          'Tempo de Carga do Capacitor (segundos)',
          'Frequência de Disparo de Marcapasso Não Invasivo (PPM)',
          'Amplitude de Corrente de Marcapasso (mA)',
          'Forma de Onda Bipásica'
        ]),
        is_mandatory: 1
      },
      {
        id: 2,
        category_id: 1,
        analyzer_type: 'Analisador de Segurança Elétrica',
        required_parameters: JSON.stringify([
          'Resistência do Condutor de Proteção à Terra (mΩ)',
          'Resistência de Isolamento (MΩ)',
          'Corrente de Fuga no Chassi (µA)',
          'Corrente de Fuga nas Partes Aplicadas Tipo CF (µA)'
        ]),
        is_mandatory: 1
      },
      {
        id: 3,
        category_id: 2,
        analyzer_type: 'Simulador de Sinais Vitais (Multiparamétrico)',
        required_parameters: JSON.stringify([
          'Simulação ECG Frequência Cardíaca (30, 60, 120, 240 BPM)',
          'Curva de Arritmia Ventricular e Supraventricular',
          'Saturação de Oxigênio SpO2 (80%, 90%, 97%)',
          'Pressão Arterial Não Invasiva PNI (120/80, 200/150 mmHg)',
          'Capnografia EtCO2 (38 mmHg)'
        ]),
        is_mandatory: 1
      },
      {
        id: 4,
        category_id: 3,
        analyzer_type: 'Analisador de Fluxo de Gás e Pressão',
        required_parameters: JSON.stringify([
          'Volume Corrente Entregue (mL)',
          'Pressão Inspiratória de Pico PIP (cmH2O)',
          'Pressão Positiva ao Final da Expiração PEEP (cmH2O)',
          'Concentração de Oxigênio FiO2 (21% a 100%)',
          'Frequência Respiratória (BPM)'
        ]),
        is_mandatory: 1
      },
      {
        id: 5,
        category_id: 4,
        analyzer_type: 'Analisador de Infusão / Fluxômetro',
        required_parameters: JSON.stringify([
          'Vazão Volumétrica (mL/h)',
          'Pressão de Oclusão (PSI / mmHg)',
          'Precisão de Infusão em Bolus'
        ]),
        is_mandatory: 1
      }
    ];
  }

  // O inventário real é importado da planilha PAT03-F1 para o Supabase.
  // Não gerar patrimônios demonstrativos quando o armazenamento local estiver vazio.

  saveStore();
}

export const getDB = () => store;
export const saveDB = () => saveStore();
