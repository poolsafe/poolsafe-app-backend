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
  };
}

const dbUrl = process.env['DATABASE_URL'];
if (!dbUrl) {
  console.error('ERRO: DATABASE_URL não definida.');
  process.exit(1);
}

const adapter = new PrismaMariaDb(parseDatabaseUrl(dbUrl));
const prisma = new PrismaClient({ adapter });

async function seedHomeDev() {
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];

  let targetEmail: string | undefined;
  let scenario = 'online';

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
    console.error('Crie uma conta ou informe o e-mail: npm run seed:home -- email@exemplo.com');
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`PoolSafe — Gerador de Cenários de Teste da Home`);
  console.log(`Usuário: ${user.name} (${user.email}) [ID: ${user.id}]`);
  console.log(`Cenário solicitado: ${scenario.toUpperCase()}`);
  console.log(`======================================================\n`);

  const now = new Date();

  // CENÁRIO LIMPO / VAZIO TOTAL: remove câmeras e sessões do usuário
  if (scenario === 'limpo' || scenario === 'sem-camera') {
    await prisma.alertRecipient.deleteMany({ where: { userId: user.id } });
    await prisma.cameraAccess.deleteMany({ where: { userId: user.id } });

    console.log('✅ Estado Vazio aplicado com sucesso!');
    console.log('   - Câmeras associadas: 0');
    console.log('   - Sessões ativas: 0');
    console.log('   - Alertas recentes: nenhum');
    console.log('\nAbra o aplicativo ou faça Pull-to-Refresh para visualizar o estado vazio.');
    return;
  }

  // Criação ou atualização das câmeras base
  // No cenário degradado, a câmera 2 fica sem comunicação há 10 minutos (> 90s)
  const cam1Comm = now;
  const cam2Comm = scenario === 'degradado'
    ? new Date(now.getTime() - 600_000) // 10 minutos atrás
    : now;

  const cam1 = await prisma.camera.upsert({
    where: { integrationCode: `dev-cam-piscina-principal-${user.id}` },
    update: {
      name: 'Piscina Principal',
      location: 'Área externa',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: cam1Comm,
    },
    create: {
      integrationCode: `dev-cam-piscina-principal-${user.id}`,
      name: 'Piscina Principal',
      location: 'Área externa',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: cam1Comm,
    },
  });

  const cam2 = await prisma.camera.upsert({
    where: { integrationCode: `dev-cam-deck-piscina-${user.id}` },
    update: {
      name: 'Deck e Prainha',
      location: 'Área gourmet',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: cam2Comm,
    },
    create: {
      integrationCode: `dev-cam-deck-piscina-${user.id}`,
      name: 'Deck e Prainha',
      location: 'Área gourmet',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: cam2Comm,
    },
  });

  // Garante acesso ativo às duas câmeras
  for (const cam of [cam1, cam2]) {
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

  // Gerencia o Monitoramento conforme o cenário
  let monitoring = await prisma.monitoring.findFirst({
    where: {
      monitoringCameras: { some: { cameraId: cam1.id } },
    },
    orderBy: { id: 'desc' },
  });

  if (scenario === 'sem-sessao' || scenario === 'vazio') {
    // Encerra qualquer sessão aberta
    if (monitoring && monitoring.status !== 'ENCERRADO') {
      await prisma.monitoring.update({
        where: { id: monitoring.id },
        data: { status: 'ENCERRADO', endedAt: now },
      });
    }
    console.log('✅ Cenário Sem Sessão de Monitoramento aplicado!');
    console.log('   - Câmeras: 2 associadas (ambas online)');
    console.log('   - Sessões ativas: 0');
    console.log('   - Esperado na Home: "Monitoramento Indisponível / Sem sessões em andamento" + aviso NO_CURRENT_MONITORING');
    return;
  }

  const monitoringStatus = scenario === 'pausado' ? 'PAUSADO' : 'ATIVO';

  if (!monitoring || monitoring.status === 'ENCERRADO') {
    monitoring = await prisma.monitoring.create({
      data: {
        status: monitoringStatus,
        startedByUserId: user.id,
        startedAt: new Date(now.getTime() - 3600000), // Iniciado há 1 hora
        pausedAt: scenario === 'pausado' ? now : null,
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
      data: {
        status: monitoringStatus,
        pausedAt: scenario === 'pausado' ? now : null,
      },
    });
  }

  // Gerencia o Alerta Recente conforme o cenário
  const existingAlert = await prisma.alert.findFirst({
    where: {
      cameraId: cam1.id,
      eventKey: { startsWith: `dev-alert-${user.id}` },
    },
    orderBy: { detectedAt: 'desc' },
  });

  if (scenario === 'sem-alerta') {
    await prisma.alertRecipient.deleteMany({ where: { userId: user.id } });
    console.log('✅ Cenário Sem Alertas Recentes aplicado!');
    console.log('   - Monitoramento: ATIVO');
    console.log('   - Câmeras: 2/2 ONLINE');
    console.log('   - Alertas recentes: 0 (esperado: card "Nenhum alerta recente")');
    return;
  }

  // Cria ou atualiza alerta recente (detectado há 2 minutos)
  if (!existingAlert) {
    const alert = await prisma.alert.create({
      data: {
        eventKey: `dev-alert-${user.id}-${Date.now().toString().slice(0, 8)}`,
        monitoringId: monitoring.id,
        cameraId: cam1.id,
        type: 'POSSIVEL_RISCO',
        severity: 'CRITICA',
        detectedAt: new Date(now.getTime() - 120_000), // Há 2 minutos
      },
    });

    await prisma.alertRecipient.create({
      data: {
        alertId: alert.id,
        userId: user.id,
      },
    });
  } else {
    await prisma.alert.update({
      where: { id: existingAlert.id },
      data: { detectedAt: new Date(now.getTime() - 120_000) },
    });
    // Garante destinatário
    const recipient = await prisma.alertRecipient.findFirst({
      where: { alertId: existingAlert.id, userId: user.id },
    });
    if (!recipient) {
      await prisma.alertRecipient.create({
        data: { alertId: existingAlert.id, userId: user.id },
      });
    }
  }

  console.log('✅ Cenário aplicado com sucesso!');
  if (scenario === 'online') {
    console.log('   - Monitoramento: ATIVO (Operacional)');
    console.log('   - Câmeras: 2/2 ONLINE (Piscina Principal e Deck)');
    console.log('   - Alerta Recente: 1 Crítico recente');
    console.log('   - Esperado na Home: Badge turquesa ATIVO, sem avisos de erro.');
  } else if (scenario === 'degradado') {
    console.log('   - Monitoramento: DEGRADADO');
    console.log('   - Câmeras: 1/2 ONLINE (1 câmera offline há 10 min)');
    console.log('   - Avisos: CAMERA_OFFLINE');
    console.log('   - Esperado na Home: Badge amarelo DEGRADADO, aviso de câmera sem sinal.');
  } else if (scenario === 'pausado') {
    console.log('   - Monitoramento: PAUSADO');
    console.log('   - Câmeras: 2/2 ONLINE');
    console.log('   - Avisos: MONITORING_PAUSED');
    console.log('   - Esperado na Home: Badge amarelo PAUSADO, aviso de monitoramento pausado.');
  }

  console.log('\nAbra o aplicativo ou puxe para baixo (Pull-to-Refresh) para visualizar a mudança.');
}

seedHomeDev()
  .catch((err) => {
    console.error('Erro ao semear dados:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
