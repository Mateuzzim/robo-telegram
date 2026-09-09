const lt = require('localtunnel');

const PORT = process.env.PORT || 3000;

(async () => {
  console.log('\nIniciando tunnel para acesso remoto...\n');

  try {
    const tunnel = await lt({ port: PORT });

    console.log('╔══════════════════════════════════════════════╗');
    console.log('  ACESSO REMOTO ATIVADO');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`  URL PUBLICA: ${tunnel.url}`);
    console.log('╠══════════════════════════════════════════════╣');
    console.log('  Abra essa URL no celular de qualquer lugar');
    console.log('  mantenha este terminal aberto');
    console.log('╚══════════════════════════════════════════════╝\n');

    tunnel.on('close', () => {
      console.log('[Tunnel] Conexao encerrada');
      process.exit(0);
    });

    tunnel.on('error', (err) => {
      console.error('[Tunnel] Erro:', err.message);
    });

    process.on('SIGINT', () => {
      console.log('\n[Tunnel] Encerrando...');
      tunnel.close();
      process.exit(0);
    });

  } catch (err) {
    console.error('[Tunnel] Falha ao iniciar:', err.message);
    console.error('\nPossiveis causas:');
    console.error('  - Sem conexao com a internet');
    console.error('  - Servidor localtunnel fora do ar');
    process.exit(1);
  }
})();
