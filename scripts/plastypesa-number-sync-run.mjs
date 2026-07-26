process.env.PLASTYPESA_SUITES = 'number-sync';
const { runPlastyPesaApiSuite } = await import('./plastypesa/index.mjs');
process.exit((await runPlastyPesaApiSuite()) || 0);
