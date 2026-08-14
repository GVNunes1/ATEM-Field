const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { getSupabaseConfig } = require('./supabase-env');

const dryRun = process.argv.includes('--dry-run');
const catalogPath = path.resolve(__dirname, '../data/preventive-checklist-catalog.json');
const checklistDir = path.resolve(__dirname, '../../checklists de preventivas/equipamentos');

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR');
}

function stableJson(value) {
  return JSON.stringify(value || []);
}

function templateKey(categoryId, analyzerType) {
  return `${categoryId}:${normalize(analyzerType)}`;
}

function validateCatalog(catalog, inventoryTypes) {
  if (!catalog || !Array.isArray(catalog.categories) || catalog.categories.length === 0) {
    throw new Error('Catálogo inválido: categories deve ser um array não vazio.');
  }

  const categoryNames = new Set();
  const catalogFiles = new Set();
  const missingInventoryTypes = new Set();

  for (const category of catalog.categories) {
    if (!category.name || !Array.isArray(category.source_files) || category.source_files.length === 0) {
      throw new Error(`Categoria inválida: ${category.name || '<sem nome>'}.`);
    }

    const normalizedName = normalize(category.name);
    if (categoryNames.has(normalizedName)) {
      throw new Error(`Categoria duplicada no catálogo: ${category.name}.`);
    }
    categoryNames.add(normalizedName);

    for (const sourceFile of category.source_files) {
      if (catalogFiles.has(sourceFile)) {
        throw new Error(`Checklist associada a mais de uma categoria: ${sourceFile}.`);
      }
      catalogFiles.add(sourceFile);
    }

    const analyzerTypes = new Set();
    for (const template of category.templates || []) {
      const normalizedType = normalize(template.analyzer_type);
      if (!template.analyzer_type || !Array.isArray(template.required_parameters) || template.required_parameters.length === 0) {
        throw new Error(`Template inválido em ${category.name}.`);
      }
      if (analyzerTypes.has(normalizedType)) {
        throw new Error(`Padrão duplicado em ${category.name}: ${template.analyzer_type}.`);
      }
      analyzerTypes.add(normalizedType);
      if (!inventoryTypes.has(normalizedType)) missingInventoryTypes.add(template.analyzer_type);
    }
  }

  const diskFiles = fs.readdirSync(checklistDir)
    .filter((file) => file.toLocaleLowerCase('pt-BR').endsWith('.docx'))
    // Word creates transient lock/owner files beside open documents.
    .filter((file) => !file.startsWith('~$'));
  const missingFromCatalog = diskFiles.filter((file) => !catalogFiles.has(file));
  const missingFromDisk = [...catalogFiles].filter((file) => !diskFiles.includes(file));

  if (missingFromCatalog.length || missingFromDisk.length) {
    throw new Error(`Cobertura de arquivos inválida. Sem categoria: ${missingFromCatalog.join(', ') || '-'}; ausentes no disco: ${missingFromDisk.join(', ') || '-'}.`);
  }
  if (missingInventoryTypes.size) {
    throw new Error(`Tipos de padrão ausentes no inventário: ${[...missingInventoryTypes].join(', ')}.`);
  }

  return { sourceFileCount: catalogFiles.size };
}

function buildTemplateRow(category, categoryId, template) {
  return {
    category_id: categoryId,
    name: template.analyzer_type,
    analyzer_type: template.analyzer_type,
    description: template.description || `Grandezas extraídas de: ${category.source_files.join(', ')}`,
    required_parameters: template.required_parameters,
    is_mandatory: template.is_mandatory ?? 1
  };
}

function templateDiffers(existing, desired) {
  return existing.name !== desired.name
    || existing.description !== desired.description
    || Number(existing.is_mandatory) !== Number(desired.is_mandatory)
    || stableJson(existing.required_parameters) !== stableJson(desired.required_parameters);
}

async function fetchCurrentState(client) {
  const [categories, templates, analyzers] = await Promise.all([
    client.from('equipment_categories').select('id,name,description').order('id'),
    client.from('test_templates').select('id,category_id,name,analyzer_type,description,required_parameters,is_mandatory').order('id'),
    client.from('analyzers').select('type').not('type', 'is', null)
  ]);
  for (const result of [categories, templates, analyzers]) {
    if (result.error) throw result.error;
  }
  return {
    categories: categories.data || [],
    templates: templates.data || [],
    inventoryTypes: new Set((analyzers.data || []).map((item) => normalize(item.type)))
  };
}

async function printDryRun(catalog, state, sourceFileCount) {
  const currentCategories = new Map(state.categories.map((item) => [normalize(item.name), item]));
  const currentTemplates = new Map(state.templates.map((item) => [templateKey(item.category_id, item.analyzer_type), item]));
  const summary = {
    dry_run: true,
    source_files: sourceFileCount,
    catalog_categories: catalog.categories.length,
    catalog_templates: catalog.categories.reduce((total, category) => total + (category.templates || []).length, 0),
    categories_to_create: 0,
    categories_to_update: 0,
    templates_to_create: 0,
    templates_to_update: 0,
    legacy_templates_to_replace: 0
  };

  for (const category of catalog.categories) {
    const existingCategory = currentCategories.get(normalize(category.name));
    if (!existingCategory) {
      summary.categories_to_create += 1;
      summary.templates_to_create += (category.templates || []).length;
      continue;
    }
    if (existingCategory.description !== category.description) summary.categories_to_update += 1;

    for (const [legacyType, replacementType] of Object.entries(category.replace_template_types || {})) {
      const legacy = currentTemplates.get(templateKey(existingCategory.id, legacyType));
      const replacement = currentTemplates.get(templateKey(existingCategory.id, replacementType));
      if (legacy && !replacement) summary.legacy_templates_to_replace += 1;
    }

    for (const template of category.templates || []) {
      const existingTemplate = currentTemplates.get(templateKey(existingCategory.id, template.analyzer_type));
      if (!existingTemplate) {
        const replaces = Object.entries(category.replace_template_types || {})
          .some(([legacyType, replacementType]) => normalize(replacementType) === normalize(template.analyzer_type)
            && currentTemplates.has(templateKey(existingCategory.id, legacyType)));
        if (!replaces) summary.templates_to_create += 1;
      } else if (templateDiffers(existingTemplate, buildTemplateRow(category, existingCategory.id, template))) {
        summary.templates_to_update += 1;
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

async function applyCatalog(client, catalog, sourceFileCount) {
  const categoryRows = catalog.categories.map((category) => ({
    name: category.name,
    description: category.description
  }));
  const categoryResult = await client.from('equipment_categories').upsert(categoryRows, { onConflict: 'name' });
  if (categoryResult.error) throw categoryResult.error;

  const refreshed = await fetchCurrentState(client);
  const categoryMap = new Map(refreshed.categories.map((item) => [normalize(item.name), item]));
  const existingTemplates = new Map(refreshed.templates.map((item) => [templateKey(item.category_id, item.analyzer_type), item]));
  const updates = [];
  const inserts = [];
  let replacementCount = 0;

  for (const category of catalog.categories) {
    const databaseCategory = categoryMap.get(normalize(category.name));
    if (!databaseCategory) throw new Error(`Categoria não encontrada após upsert: ${category.name}.`);

    const desiredTemplates = new Map((category.templates || []).map((template) => [normalize(template.analyzer_type), template]));
    for (const [legacyType, replacementType] of Object.entries(category.replace_template_types || {})) {
      const legacyKey = templateKey(databaseCategory.id, legacyType);
      const replacementKey = templateKey(databaseCategory.id, replacementType);
      const legacy = existingTemplates.get(legacyKey);
      const replacement = existingTemplates.get(replacementKey);
      const desired = desiredTemplates.get(normalize(replacementType));
      if (legacy && !replacement && desired) {
        const row = { id: legacy.id, ...buildTemplateRow(category, databaseCategory.id, desired) };
        updates.push(row);
        existingTemplates.delete(legacyKey);
        existingTemplates.set(replacementKey, row);
        replacementCount += 1;
      }
    }

    for (const template of category.templates || []) {
      const desired = buildTemplateRow(category, databaseCategory.id, template);
      const existing = existingTemplates.get(templateKey(databaseCategory.id, template.analyzer_type));
      if (!existing) {
        inserts.push(desired);
      } else if (templateDiffers(existing, desired)) {
        updates.push({ id: existing.id, ...desired });
      }
    }
  }

  if (updates.length) {
    const updateResult = await client.from('test_templates').upsert(updates, { onConflict: 'id' });
    if (updateResult.error) throw updateResult.error;
  }
  if (inserts.length) {
    const insertResult = await client.from('test_templates').insert(inserts);
    if (insertResult.error) throw insertResult.error;
  }

  const verified = await fetchCurrentState(client);
  const verifiedCategories = new Map(verified.categories.map((item) => [normalize(item.name), item]));
  const verifiedTemplates = new Map();
  for (const item of verified.templates) {
    const key = templateKey(item.category_id, item.analyzer_type);
    if (verifiedTemplates.has(key)) throw new Error(`Template duplicado após sincronização: ${key}.`);
    verifiedTemplates.set(key, item);
  }

  for (const category of catalog.categories) {
    const databaseCategory = verifiedCategories.get(normalize(category.name));
    if (!databaseCategory) throw new Error(`Falha de verificação da categoria: ${category.name}.`);
    for (const template of category.templates || []) {
      const existing = verifiedTemplates.get(templateKey(databaseCategory.id, template.analyzer_type));
      const desired = buildTemplateRow(category, databaseCategory.id, template);
      if (!existing || templateDiffers(existing, desired)) {
        throw new Error(`Falha de verificação do template ${category.name} / ${template.analyzer_type}.`);
      }
    }
  }

  console.log(JSON.stringify({
    dry_run: false,
    source_files: sourceFileCount,
    catalog_categories: catalog.categories.length,
    catalog_templates: catalog.categories.reduce((total, category) => total + (category.templates || []).length, 0),
    template_rows_inserted: inserts.length,
    template_rows_updated: updates.length,
    legacy_templates_replaced: replacementCount,
    verified: true
  }, null, 2));
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const config = getSupabaseConfig();
  const client = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false } });
  const state = await fetchCurrentState(client);
  const { sourceFileCount } = validateCatalog(catalog, state.inventoryTypes);

  if (dryRun) await printDryRun(catalog, state, sourceFileCount);
  else await applyCatalog(client, catalog, sourceFileCount);
}

main().catch((error) => {
  console.error(`Checklist sync failed: ${error.message}`);
  process.exitCode = 1;
});
