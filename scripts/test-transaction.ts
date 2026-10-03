import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

interface MariaDbPoolConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  database?: string;
  connectionLimit: number;
  allowPublicKeyRetrieval?: boolean;
}

function parseDatabaseUrl(rawUrl: string): MariaDbPoolConfig {
  const parsed = new URL(rawUrl);
  let host = parsed.hostname;
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (!host) {
    host = 'localhost';
  }

  const parsedPort = parsed.port ? parseInt(parsed.port, 10) : 3306;
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3306;

  const user = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  const rawPath = parsed.pathname.replace(/^\/+/, '');
  const database = rawPath ? decodeURIComponent(rawPath) : undefined;

  return {
    host,
    port,
    user,
    password,
    database,
    connectionLimit: 5,
    allowPublicKeyRetrieval: true,
  };
}

async function main() {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL não configurada');
  }

  console.log('[Teste Transacional] Conectando ao MySQL...');
  const poolConfig = parseDatabaseUrl(url);
  const adapter = new PrismaMariaDb(poolConfig);
  const prisma = new PrismaClient({ adapter });

  await prisma.$connect();
  console.log('[Teste Transacional] Conexão estabelecida.');

  const testEmail = 'teste.transacao.temporario@poolsafe.local';
  const testCamCode = 'CAM_TEST_TEMP_999';

  console.log('[Teste Transacional] Iniciando bloco transacional reversível...');

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Criar Usuário
      const user = await tx.user.create({
        data: {
          name: 'Usuário Temporário Transação',
          email: testEmail,
          passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$temp_hash',
          phone: '11988887777',
          status: 'ATIVO',
        },
      });
      console.log(`[Teste Transacional] Usuário criado dentro da transação. ID: ${user.id}`);

      // 2. Criar Câmera
      const camera = await tx.camera.create({
        data: {
          integrationCode: testCamCode,
          name: 'Câmera Temporária Transação',
          location: 'Piscina Teste',
          administrativeStatus: 'ATIVA',
        },
      });
      console.log(`[Teste Transacional] Câmera criada dentro da transação. ID: ${camera.id}`);

      // 3. Criar Acesso à Câmera (acesso_camera)
      const access = await tx.cameraAccess.create({
        data: {
          userId: user.id,
          cameraId: camera.id,
          active: true,
        },
      });
      console.log(`[Teste Transacional] Acesso à câmera criado dentro da transação. ID: ${access.id}`);

      // 4. Criar Monitoramento (monitoramento)
      const monitoring = await tx.monitoring.create({
        data: {
          startedByUserId: user.id,
          status: 'ATIVO',
        },
      });
      console.log(`[Teste Transacional] Monitoramento criado dentro da transação. ID: ${monitoring.id}`);

      // 5. Vincular Monitoramento e Câmera (monitoramento_camera)
      await tx.monitoringCamera.create({
        data: {
          monitoringId: monitoring.id,
          cameraId: camera.id,
        },
      });
      console.log(`[Teste Transacional] Vínculo monitoramento_camera criado dentro da transação.`);

      // Forçar intencionalmente o ROLLBACK
      throw new Error('ROLLBACK_INTENCIONAL_DE_TESTE');
    });
  } catch (err: any) {
    if (err.message === 'ROLLBACK_INTENCIONAL_DE_TESTE') {
      console.log('[Teste Transacional] Erro intencional disparado. ROLLBACK efetuado pelo Prisma.');
    } else {
      throw err;
    }
  }

  // Validação pós-rollback: confirmar que nenhum dado foi persistido no banco
  console.log('[Teste Transacional] Verificando se algum dado foi persistido no banco...');
  const userCount = await prisma.user.count({ where: { email: testEmail } });
  const cameraCount = await prisma.camera.count({ where: { integrationCode: testCamCode } });

  console.log(`[Teste Transacional] Usuários persistidos com e-mail de teste: ${userCount}`);
  console.log(`[Teste Transacional] Câmeras persistidas com código de teste: ${cameraCount}`);

  if (userCount === 0 && cameraCount === 0) {
    console.log('[Teste Transacional] SUCESSO: Nenhum dado de teste permaneceu gravado no banco.');
  } else {
    throw new Error('FALHA: O rollback não limpou os dados de teste!');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[Teste Transacional] Erro inesperado:', err);
  process.exit(1);
});
