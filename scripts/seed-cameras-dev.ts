import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

function parseDatabaseUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  let host = parsed.hostname;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return {
    host: host || 'localhost',
    port: parsed.port ? parseInt(parsed.port, 10) : 3306,
    user: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    database: parsed.pathname.replace(/^\/+/, '') || undefined,
    connectionLimit: 5,
    allowPublicKeyRetrieval: true,
  };
}

const dbUrl = process.env['DATABASE_URL'];
if (!dbUrl) {
  console.error('ERRO: DATABASE_URL não definida.');
  process.exit(1);
}

const adapter = new PrismaMariaDb(parseDatabaseUrl(dbUrl));
const prisma = new PrismaClient({ adapter });

async function seedCamerasDev() {
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];

  let targetEmail: string | undefined;
  let scenario = 'padrao';

  if (arg1 && arg1.includes('@')) {
    targetEmail = arg1;
    if (arg2) scenario = arg2.toLowerCase();
  } else if (arg1) {
    scenario = arg1.toLowerCase();
  }

  // Encontra o usuário alvo
  const user = targetEmail
    ? await prisma.user.findUnique({ where: { email: targetEmail } })
    : (await prisma.user.findFirst({
        where: { status: 'ATIVO', email: { not: { startsWith: 'test.' } } },
        orderBy: { id: 'asc' },
      })) ??
      (await prisma.user.findFirst({
        where: { status: 'ATIVO' },
        orderBy: { id: 'asc' },
      }));

  if (!user) {
    console.error('Nenhum usuário ativo encontrado no banco.');
    console.error('Informe o e-mail: npm run seed:cameras -- email@exemplo.com');
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`PoolSafe — Gerador de Cenários de Teste de Câmeras (Fatia 5)`);
  console.log(`Usuário: ${user.name} (${user.email}) [ID: ${user.id}]`);
  console.log(`Cenário solicitado: ${scenario.toUpperCase()}`);
  console.log(`======================================================\n`);

  const now = new Date();

  // CENÁRIO LIMPO / VAZIO: remove vínculos de câmeras e alertas do usuário
  if (scenario === 'limpo' || scenario === 'sem-camera' || scenario === 'vazio') {
    await prisma.alertRecipient.deleteMany({ where: { userId: user.id } });
    await prisma.cameraAccess.deleteMany({ where: { userId: user.id } });

    console.log('✅ Estado Vazio aplicado com sucesso!');
    console.log('   - Câmeras associadas: 0');
    console.log('   - Esperado no app: Card de estado vazio ("Nenhuma câmera associada")');
    return;
  }

  // 1. Câmera 1: Piscina Principal (Online, com monitoramento ativo, com alertas e evidências)
  const cam1 = await prisma.camera.upsert({
    where: { integrationCode: `dev-cam-piscina-principal-${user.id}` },
    update: {
      name: 'Piscina Principal',
      location: 'Área externa norte',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: now,
    },
    create: {
      integrationCode: `dev-cam-piscina-principal-${user.id}`,
      name: 'Piscina Principal',
      location: 'Área externa norte',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: now,
    },
  });

  // 2. Câmera 2: Deck e Prainha (Offline há 10 minutos > 90s, com monitoramento ativo)
  const cam2 = await prisma.camera.upsert({
    where: { integrationCode: `dev-cam-deck-piscina-${user.id}` },
    update: {
      name: 'Deck e Prainha',
      location: 'Área externa sul',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: new Date(now.getTime() - 600_000), // 10 min atrás
    },
    create: {
      integrationCode: `dev-cam-deck-piscina-${user.id}`,
      name: 'Deck e Prainha',
      location: 'Área externa sul',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: new Date(now.getTime() - 600_000),
    },
  });

  // 3. Câmera 3: Área Gourmet (Desconhecida: nunca comunicou, sem monitoramento)
  const cam3 = await prisma.camera.upsert({
    where: { integrationCode: `dev-cam-area-gourmet-${user.id}` },
    update: {
      name: 'Área Gourmet',
      location: 'Churrasqueira',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: null,
    },
    create: {
      integrationCode: `dev-cam-area-gourmet-${user.id}`,
      name: 'Área Gourmet',
      location: 'Churrasqueira',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: null,
    },
  });

  // 4. Câmera 4: Portão de Acesso (Inativa administrativamente, sem monitoramento)
  const cam4 = await prisma.camera.upsert({
    where: { integrationCode: `dev-cam-portao-acesso-${user.id}` },
    update: {
      name: 'Portão da Piscina',
      location: 'Corredor lateral',
      administrativeStatus: 'INATIVA',
      lastCommunicationAt: new Date(now.getTime() - 86_400_000), // 1 dia atrás
      deactivatedAt: new Date(now.getTime() - 86_400_000),
    },
    create: {
      integrationCode: `dev-cam-portao-acesso-${user.id}`,
      name: 'Portão da Piscina',
      location: 'Corredor lateral',
      administrativeStatus: 'INATIVA',
      lastCommunicationAt: new Date(now.getTime() - 86_400_000),
      deactivatedAt: new Date(now.getTime() - 86_400_000),
    },
  });

  // Garante acesso ativo às 4 câmeras para o usuário
  for (const cam of [cam1, cam2, cam3, cam4]) {
    const existingAccess = await prisma.cameraAccess.findFirst({
      where: { userId: user.id, cameraId: cam.id },
    });
    if (!existingAccess) {
      await prisma.cameraAccess.create({
        data: { userId: user.id, cameraId: cam.id, active: true },
      });
    } else {
      await prisma.cameraAccess.update({
        where: { id: existingAccess.id },
        data: { active: true, revokedAt: null },
      });
    }
  }

  // 5. Monitoramento
  let monitoring = await prisma.monitoring.findFirst({
    where: {
      monitoringCameras: { some: { cameraId: cam1.id } },
    },
    orderBy: { id: 'desc' },
  });

  if (scenario === 'sem-monitoramento') {
    if (monitoring && monitoring.status !== 'ENCERRADO') {
      await prisma.monitoring.update({
        where: { id: monitoring.id },
        data: { status: 'ENCERRADO', endedAt: now },
      });
    }
  } else {
    // Monitoramento ATIVO envolvendo Cam 1 e Cam 2
    if (!monitoring || monitoring.status === 'ENCERRADO') {
      monitoring = await prisma.monitoring.create({
        data: {
          status: 'ATIVO',
          startedByUserId: user.id,
          startedAt: new Date(now.getTime() - 7200_000),
        },
      });

      await prisma.monitoringCamera.createMany({
        data: [
          { monitoringId: monitoring.id, cameraId: cam1.id },
          { monitoringId: monitoring.id, cameraId: cam2.id },
        ],
        skipDuplicates: true,
      });
    } else {
      await prisma.monitoring.update({
        where: { id: monitoring.id },
        data: { status: 'ATIVO', pausedAt: null },
      });
      await prisma.monitoringCamera.createMany({
        data: [
          { monitoringId: monitoring.id, cameraId: cam1.id },
          { monitoringId: monitoring.id, cameraId: cam2.id },
        ],
        skipDuplicates: true,
      });
    }
  }

  // 6. Alertas
  if (scenario === 'sem-alerta') {
    await prisma.alertRecipient.deleteMany({ where: { userId: user.id } });
    console.log('✅ Cenário Sem Alertas aplicado!');
  } else if (monitoring) {
    // Cria 6 alertas recentes para a Piscina Principal
    for (let i = 1; i <= 6; i++) {
      const eventKey = `dev-alert-${user.id}-cam1-${i}`;
      let alert = await prisma.alert.findUnique({ where: { eventKey } });

      const detectedAt = new Date(now.getTime() - i * 360_000); // 6 min, 12 min, etc
      if (!alert) {
        alert = await prisma.alert.create({
          data: {
            eventKey,
            monitoringId: monitoring.id,
            cameraId: cam1.id,
            type: 'POSSIVEL_RISCO',
            severity: i % 2 === 0 ? 'CRITICA' : 'ATENCAO',
            detectedAt,
          },
        });
      } else {
        await prisma.alert.update({
          where: { id: alert.id },
          data: { detectedAt },
        });
      }

      // Adiciona evidência ao primeiro alerta (se ainda não existir)
      if (i === 1) {
        const existingEvidence = await prisma.alertEvidence.findUnique({
          where: { alertId: alert.id },
        });
        if (!existingEvidence) {
          await prisma.alertEvidence.create({
            data: {
              alertId: alert.id,
              mimeType: 'image/jpeg',
              content: Buffer.from('fake image binary content'),
              sizeBytes: BigInt(2048),
              hashSha256: 'c'.repeat(64),
              expiresAt: new Date(now.getTime() + 30 * 86_400_000),
              removedAt: null,
            },
          });
        }
      }

      // Garante destinatário
      const recipient = await prisma.alertRecipient.findFirst({
        where: { alertId: alert.id, userId: user.id },
      });
      if (!recipient) {
        await prisma.alertRecipient.create({
          data: { alertId: alert.id, userId: user.id },
        });
      }
    }
  }

  console.log('✅ Cenário de Câmeras aplicado com sucesso!');
  console.log('   1. Piscina Principal: ATIVA, ONLINE, Monitoramento ATIVO (Degradado pela Cam 2), com 6 alertas recentes');
  console.log('   2. Deck e Prainha: ATIVA, OFFLINE (sem sinal há 10 min), Monitoramento ATIVO');
  console.log('   3. Área Gourmet: ATIVA, DESCONHECIDA (sem comunicação registrada), sem monitoramento');
  console.log('   4. Portão da Piscina: INATIVA, OFFLINE, sem monitoramento');
  console.log('\nAbra a aba Câmeras no aplicativo e puxe para baixo (Pull-to-Refresh) para visualizar.');
}

seedCamerasDev()
  .catch((err) => {
    console.error('Erro ao semear dados de câmeras:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
