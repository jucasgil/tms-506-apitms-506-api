// Crea la API Key de un cliente OMS nuevo.
// Uso:  npm run crear-api-key -- "Nombre del cliente" [sandbox|live]
// Imprime la llave y el secreto de webhooks UNA sola vez: entrégalos al cliente y no los guardes en texto plano.
const { createClient } = require('@supabase/supabase-js');
const { hashApiKey, nuevaApiKey, nuevoSecreto } = require('../src/lib/calculos');

async function main() {
  const [nombre, entorno = 'sandbox'] = process.argv.slice(2);
  if (!nombre || !['sandbox', 'live'].includes(entorno)) {
    console.error('Uso: npm run crear-api-key -- "Nombre del cliente" [sandbox|live]');
    process.exit(1);
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno');
    process.exit(1);
  }
  const apiKey = nuevaApiKey(entorno === 'live' ? 'live' : 'test');
  const webhookSecret = nuevoSecreto();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { error } = await sb.from('api_keys').insert({
    cliente_nombre: nombre, api_key_hash: hashApiKey(apiKey), webhook_secret: webhookSecret, entorno,
  });
  if (error) throw error;
  console.log(`\nCliente:          ${nombre} (${entorno})\nAPI Key:          ${apiKey}\nWebhook secret:   ${webhookSecret}\n`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
