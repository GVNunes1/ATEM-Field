# Original User Request

## Initial Request — 2026-08-12T11:46:46Z

<USER_REQUEST>
Criar e implantar a infraestrutura de banco de dados PostgreSQL no Supabase para a plataforma ATEM Field, estruturando os schemas relacionais para Técnicos, Agenda de Atendimentos e Padrões/Equipamentos (Analisadores, Categorias e Templates), migrando 100% dos dados reais e conectando o backend TypeScript.

Working directory: c:\Users\tecnico.mmAT31\Documents\antigravity\quick-turing
Integrity mode: development

## Requirements

### R1. Schemas Relacionais no Supabase (Técnicos, Agenda e Padrões)
Criar e aplicar as migrações SQL no PostgreSQL do Supabase utilizando o MCP do Supabase (`execute_sql`, `apply_migration`):
- **Técnicos (`technicians`)**: `id`, `name`, `phone`, `telegram_id`, `email`, `role`, `status`, `created_at`.
- **Agenda (`appointments` & `appointment_technicians`)**: `id`, `external_id`, `title`, `client_name`, `client_address`, `appointment_date`, `appointment_time`, `status`, `technician_names`, além do relacionamento N:N com a tabela de técnicos.
- **Padrões & Equipamentos (`equipment_categories`, `test_templates`, `analyzers`, `reservations`)**: `analyzers` rastreados por patrimônio (`PAT-104050`); `test_templates` com parâmetros de teste; `reservations` com checkout/checkin.

### R2. Migração Integral dos Dados do ATEM Field
Migrar do `db.json` para o Supabase 100% dos dados autênticos do sistema:
- 1.982 agendamentos reais importados do Google Calendar.
- 120 técnicos reais catalogados.
- Lista completa de patrimônios de analisadores e templates de checklist.

### R3. Integração do Backend Node.js/TypeScript
Atualizar as rotas do backend Express para consumir o Supabase via `@supabase/supabase-js`, substituir as operações locais do `db.json` e gerar os tipos TypeScript (`database.types.ts`).

## Acceptance Criteria

### Infraestrutura & Banco no Supabase
- [ ] Tabelas `technicians`, `appointments`, `appointment_technicians`, `equipment_categories`, `test_templates`, `analyzers`, `reservations` criadas e validadas no Supabase.
- [ ] 1.982 agendamentos e 120 técnicos reais populados no Supabase.
- [ ] Backend do ATEM Field refatorado para utilizar o Supabase Client com tipos TypeScript gerados.
- [ ] Endpoints da API REST (`/api/appointments`, `/api/technicians`, `/api/analyzers`, `/api/dashboard/stats`) retornando dados diretamente do Supabase.
</USER_REQUEST>
