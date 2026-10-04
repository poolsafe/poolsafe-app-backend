import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { randomBytes, createHash } from 'node:crypto';

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

// Imagens binárias mínimas válidas para renderização em qualquer engine
const VALID_1X1_JPEG = Buffer.from(
  'ffd8ffe000104a46494600010101004800480000ffdb004300030202020202030202020303030304060404040404080606050609080a0a090809090a0c100c0a0b0e0b09090d110d0e0f101011100a0c12131210130f101010ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda0008010100003f007f00ffd9',
  'hex',
);

const VALID_1X1_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001737501180000000049454e44ae426082',
  'hex',
);

async function seedAlertsDev() {
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

  // Encontra o usuário principal
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
    console.error('Informe o e-mail: npm run seed:alerts -- email@exemplo.com');
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`PoolSafe — Gerador de Cenários de Alertas e Evidências (Fatia 7)`);
  console.log(`Usuário: ${user.name} (${user.email}) [ID: ${user.id}]`);
  console.log(`Cenário solicitado: ${scenario.toUpperCase()}`);
  console.log(`======================================================\n`);

  const now = new Date();

  // CENÁRIO LIMPO / VAZIO: remove destinatários de alerta do usuário
  if (scenario === 'limpo' || scenario === 'vazio' || scenario === 'sem-alerta') {
    await prisma.alertRecipient.deleteMany({ where: { userId: user.id } });
    console.log('✅ Estado Vazio aplicado com sucesso!');
    console.log('   - Alertas atribuídos ao usuário: 0');
    console.log('   - Esperado no app: Card de estado vazio ("Nenhum alerta registrado")');
    return;
  }

  let sampleJpegBuffer = VALID_1X1_JPEG;
  try {
    const res = await fetch('https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=800&q=80', {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      sampleJpegBuffer = Buffer.from(await res.arrayBuffer());
    }
  } catch {
    // Mantém o buffer mínimo offline
  }
  const sampleJpegSha256 = createHash('sha256').update(sampleJpegBuffer).digest('hex');

  // 1. Garante outro usuário para validação de isolamento
  const otherUser = await prisma.user.upsert({
    where: { email: 'outro_morador_dev@poolsafe.app' },
    update: { name: 'Outro Morador (Isolamento Dev)' },
    create: {
      email: 'outro_morador_dev@poolsafe.app',
      name: 'Outro Morador (Isolamento Dev)',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash$dummyhash',
      status: 'ATIVO',
    },
  });

  // 2. Garante câmeras de teste
  // Câmera A: Piscina Principal (Acesso ativo)
  const camA = await prisma.camera.upsert({
    where: { integrationCode: `dev-alerts-cam-principal-${user.id}` },
    update: {
      name: 'Piscina Principal',
      location: 'Área Externa Norte',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: now,
    },
    create: {
      integrationCode: `dev-alerts-cam-principal-${user.id}`,
      name: 'Piscina Principal',
      location: 'Área Externa Norte',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: now,
    },
  });

  // Câmera B: Deck e Prainha (Acesso ativo)
  const camB = await prisma.camera.upsert({
    where: { integrationCode: `dev-alerts-cam-deck-${user.id}` },
    update: {
      name: 'Deck e Prainha',
      location: 'Área Externa Sul',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: now,
    },
    create: {
      integrationCode: `dev-alerts-cam-deck-${user.id}`,
      name: 'Deck e Prainha',
      location: 'Área Externa Sul',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: now,
    },
  });

  // Câmera C: Área dos Fundos (Acesso REVOGADO para o usuário)
  const camC = await prisma.camera.upsert({
    where: { integrationCode: `dev-alerts-cam-revogada-${user.id}` },
    update: {
      name: 'Área dos Fundos',
      location: 'Corredor Leste',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: now,
    },
    create: {
      integrationCode: `dev-alerts-cam-revogada-${user.id}`,
      name: 'Área dos Fundos',
      location: 'Corredor Leste',
      administrativeStatus: 'ATIVA',
      lastCommunicationAt: now,
    },
  });

  // Acessos de câmera para o usuário: CamA (ativo), CamB (ativo), CamC (REVOGADO)
  const accessA = await prisma.cameraAccess.findFirst({
    where: { userId: user.id, cameraId: camA.id },
  });
  if (!accessA) {
    await prisma.cameraAccess.create({
      data: { userId: user.id, cameraId: camA.id, active: true },
    });
  } else {
    await prisma.cameraAccess.update({
      where: { id: accessA.id },
      data: { active: true, revokedAt: null },
    });
  }

  const accessB = await prisma.cameraAccess.findFirst({
    where: { userId: user.id, cameraId: camB.id },
  });
  if (!accessB) {
    await prisma.cameraAccess.create({
      data: { userId: user.id, cameraId: camB.id, active: true },
    });
  } else {
    await prisma.cameraAccess.update({
      where: { id: accessB.id },
      data: { active: true, revokedAt: null },
    });
  }

  // CamC: Acesso revogado há 2 dias (concedido há 10 dias)
  const accessC = await prisma.cameraAccess.findFirst({
    where: { userId: user.id, cameraId: camC.id },
  });
  if (!accessC) {
    await prisma.cameraAccess.create({
      data: {
        userId: user.id,
        cameraId: camC.id,
        active: false,
        grantedAt: new Date(now.getTime() - 10 * 86_400_000),
        revokedAt: new Date(now.getTime() - 2 * 86_400_000),
      },
    });
  } else {
    await prisma.cameraAccess.update({
      where: { id: accessC.id },
      data: {
        active: false,
        grantedAt: new Date(now.getTime() - 10 * 86_400_000),
        revokedAt: new Date(now.getTime() - 2 * 86_400_000),
      },
    });
  }

  // 3. Monitoramento de suporte
  let monitoring = await prisma.monitoring.findFirst({
    where: {
      startedByUserId: user.id,
      monitoringCameras: { some: { cameraId: camA.id } },
    },
    orderBy: { id: 'desc' },
  });

  if (!monitoring) {
    monitoring = await prisma.monitoring.create({
      data: {
        status: 'ATIVO',
        startedByUserId: user.id,
        startedAt: new Date(now.getTime() - 7 * 86_400_000),
      },
    });
    await prisma.monitoringCamera.createMany({
      data: [
        { monitoringId: monitoring.id, cameraId: camA.id },
        { monitoringId: monitoring.id, cameraId: camB.id },
        { monitoringId: monitoring.id, cameraId: camC.id },
      ],
      skipDuplicates: true,
    });
  }

  // 4. Criação de 25 alertas sequenciais para testar paginação (20 na pág 1 + 5 na pág 2)
  console.log('Criando / atualizando 25 alertas de teste...');

  for (let i = 1; i <= 25; i++) {
    const eventKey = `dev-alert-${user.id}-fatia7-${i}`;
    const detectedAt = new Date(now.getTime() - i * 15 * 60_000); // a cada 15 min

    // Alterna severidade entre CRITICA e ATENCAO
    const severity = i % 3 === 0 ? 'ATENCAO' : 'CRITICA';

    // Câmera: a maioria em camA, alguns em camB, e o alerta #7 em camC (câmera com acesso revogado!)
    let selectedCamera = camA;
    if (i === 7) {
      selectedCamera = camC; // Câmera com acesso revogado
    } else if (i % 2 === 0) {
      selectedCamera = camB;
    }

    const alert = await prisma.alert.upsert({
      where: { eventKey },
      update: {
        monitoringId: monitoring.id,
        cameraId: selectedCamera.id,
        type: 'POSSIVEL_RISCO',
        severity,
        detectedAt,
      },
      create: {
        eventKey,
        monitoringId: monitoring.id,
        cameraId: selectedCamera.id,
        type: 'POSSIVEL_RISCO',
        severity,
        detectedAt,
      },
    });

    // Garante que o usuário é destinatário histórico
    await prisma.alertRecipient.upsert({
      where: {
        alertId_userId: {
          alertId: alert.id,
          userId: user.id,
        },
      },
      update: {},
      create: {
        alertId: alert.id,
        userId: user.id,
      },
    });

    // Notificação de exemplo para o primeiro alerta
    if (i === 1) {
      await prisma.notification.upsert({
        where: {
          alertId_userId: {
            alertId: alert.id,
            userId: user.id,
          },
        },
        update: {
          status: 'PROCESSADA',
          processedAt: new Date(detectedAt.getTime() + 2000),
        },
        create: {
          alertId: alert.id,
          userId: user.id,
          title: 'Possível situação de risco',
          message: 'Abra o PoolSafe para verificar o alerta.',
          status: 'PROCESSADA',
          processedAt: new Date(detectedAt.getTime() + 2000),
        },
      });
    }

    // Configuração dos estados de evidência:
    // Alerta 1: JPEG disponível
    // Alerta 2: PNG disponível
    // Alerta 3: NUNCA CAPTURADA (sem registro de evidência)
    // Alerta 4: EXPIRADA (expiresAt no passado)
    // Alerta 5: REMOVIDA (removedAt preenchido, content null)
    // Alerta 6+: JPEGs e PNGs disponíveis ou sem evidência para preencher histórico
    if (i === 1) {
      await prisma.alertEvidence.upsert({
        where: { alertId: alert.id },
        update: {
          mimeType: 'image/jpeg',
          content: sampleJpegBuffer,
          sizeBytes: BigInt(sampleJpegBuffer.length),
          hashSha256: sampleJpegSha256,
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          removedAt: null,
        },
        create: {
          alertId: alert.id,
          mimeType: 'image/jpeg',
          content: sampleJpegBuffer,
          sizeBytes: BigInt(sampleJpegBuffer.length),
          hashSha256: sampleJpegSha256,
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          removedAt: null,
        },
      });
    } else if (i === 2) {
      await prisma.alertEvidence.upsert({
        where: { alertId: alert.id },
        update: {
          mimeType: 'image/png',
          content: VALID_1X1_PNG,
          sizeBytes: BigInt(VALID_1X1_PNG.length),
          hashSha256: 'b'.repeat(64),
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          removedAt: null,
        },
        create: {
          alertId: alert.id,
          mimeType: 'image/png',
          content: VALID_1X1_PNG,
          sizeBytes: BigInt(VALID_1X1_PNG.length),
          hashSha256: 'b'.repeat(64),
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          removedAt: null,
        },
      });
    } else if (i === 3) {
      // Remove registro de evidência caso já existisse
      await prisma.alertEvidence.deleteMany({ where: { alertId: alert.id } });
    } else if (i === 4) {
      // Expirada
      await prisma.alertEvidence.upsert({
        where: { alertId: alert.id },
        update: {
          mimeType: 'image/jpeg',
          content: VALID_1X1_JPEG,
          sizeBytes: BigInt(VALID_1X1_JPEG.length),
          hashSha256: 'd'.repeat(64),
          createdAt: new Date(now.getTime() - 40 * 86_400_000),
          expiresAt: new Date(now.getTime() - 5 * 86_400_000), // Expirou há 5 dias
          removedAt: null,
        },
        create: {
          alertId: alert.id,
          mimeType: 'image/jpeg',
          content: VALID_1X1_JPEG,
          sizeBytes: BigInt(VALID_1X1_JPEG.length),
          hashSha256: 'd'.repeat(64),
          createdAt: new Date(now.getTime() - 40 * 86_400_000),
          expiresAt: new Date(now.getTime() - 5 * 86_400_000),
          removedAt: null,
        },
      });
    } else if (i === 5) {
      // Removida
      await prisma.alertEvidence.upsert({
        where: { alertId: alert.id },
        update: {
          mimeType: 'image/jpeg',
          content: null,
          sizeBytes: BigInt(2048),
          hashSha256: 'e'.repeat(64),
          expiresAt: new Date(now.getTime() + 20 * 86_400_000),
          removedAt: new Date(now.getTime() - 86_400_000), // Removida ontem
        },
        create: {
          alertId: alert.id,
          mimeType: 'image/jpeg',
          content: null,
          sizeBytes: BigInt(2048),
          hashSha256: 'e'.repeat(64),
          expiresAt: new Date(now.getTime() + 20 * 86_400_000),
          removedAt: new Date(now.getTime() - 86_400_000),
        },
      });
    } else if (i % 2 === 0) {
      // Outros alertas com evidência disponível
      await prisma.alertEvidence.upsert({
        where: { alertId: alert.id },
        update: {
          mimeType: 'image/jpeg',
          content: VALID_1X1_JPEG,
          sizeBytes: BigInt(VALID_1X1_JPEG.length),
          hashSha256: 'f'.repeat(64),
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          removedAt: null,
        },
        create: {
          alertId: alert.id,
          mimeType: 'image/jpeg',
          content: VALID_1X1_JPEG,
          sizeBytes: BigInt(VALID_1X1_JPEG.length),
          hashSha256: 'f'.repeat(64),
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          removedAt: null,
        },
      });
    }
  }

  // 5. Cria alertas do OUTRO usuário para validar isolamento
  const otherEventKey = `dev-alert-other-${otherUser.id}-1`;
  const otherAlert = await prisma.alert.upsert({
    where: { eventKey: otherEventKey },
    update: {
      monitoringId: monitoring.id,
      cameraId: camA.id,
      type: 'POSSIVEL_RISCO',
      severity: 'CRITICA',
      detectedAt: now,
    },
    create: {
      eventKey: otherEventKey,
      monitoringId: monitoring.id,
      cameraId: camA.id,
      type: 'POSSIVEL_RISCO',
      severity: 'CRITICA',
      detectedAt: now,
    },
  });

  await prisma.alertRecipient.upsert({
    where: {
      alertId_userId: {
        alertId: otherAlert.id,
        userId: otherUser.id,
      },
    },
    update: {},
    create: {
      alertId: otherAlert.id,
      userId: otherUser.id,
    },
  });

  console.log('\n✅ Cenário de Alertas e Evidências aplicado com sucesso!');
  console.log(`   - 25 alertas atribuídos ao usuário ${user.name}`);
  console.log('   - Pág 1 (20 alertas) + Pág 2 (5 alertas) prontas para teste');
  console.log('   - Severidades ATENCAO e CRITICA distribuídas');
  console.log('   - Câmeras diferentes (Piscina Principal e Deck e Prainha)');
  console.log('   - Alerta #1: Evidência JPEG disponível');
  console.log('   - Alerta #2: Evidência PNG disponível');
  console.log('   - Alerta #3: Evidência nunca capturada (NOT_CAPTURED)');
  console.log('   - Alerta #4: Evidência expirada (EXPIRED)');
  console.log('   - Alerta #5: Evidência removida (REMOVED)');
  console.log('   - Alerta #7: Câmera com acesso revogado (preservado no histórico)');
  console.log('   - Alerta isolado atribuído a outro morador (não deve aparecer)');
  console.log('\nComandos de cenário disponíveis:');
  console.log('   npm run seed:alerts               (aplica os 25 alertas com todos os cenários)');
  console.log('   npm run seed:alerts -- vazio       (aplica o estado de Histórico vazio)');
}

seedAlertsDev()
  .catch((err) => {
    console.error('Erro ao semear alertas de desenvolvimento:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
