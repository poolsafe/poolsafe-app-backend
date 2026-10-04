import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

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

const DEFAULT_REAL_POOL_IMAGE_URL =
  'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=900&q=85';

async function main() {
  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) {
    console.error('ERRO: DATABASE_URL não definida.');
    process.exit(1);
  }

  const adapter = new PrismaMariaDb(parseDatabaseUrl(dbUrl));
  const prisma = new PrismaClient({ adapter });

  try {
    const args = process.argv.slice(2);
    // Argumentos suportados:
    // 1. npm run set:evidence
    // 2. npm run set:evidence <url-ou-caminho-local>
    // 3. npm run set:evidence <url-ou-caminho-local> <alertId-ou-email>
    let source: string | undefined = args[0];
    let target = args[1];

    // Se o primeiro argumento for número ou email e o segundo não existir, inverte
    if (source && (source.includes('@') || /^\d+$/.test(source)) && !target) {
      target = source;
      source = undefined;
    }

    const imageSource = source || DEFAULT_REAL_POOL_IMAGE_URL;

    console.log('\n======================================================');
    console.log('PoolSafe — Inserir Imagem Real (Blob) na Evidência');
    console.log('======================================================');

    // 1. Obter os bytes da imagem (Download via URL ou leitura de arquivo local)
    let buffer: Buffer;
    let mimeType = 'image/jpeg';

    if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
      console.log(`Baixando imagem da web:\n-> ${imageSource}`);
      const response = await fetch(imageSource);
      if (!response.ok) {
        throw new Error(`Falha no download da imagem: HTTP ${response.status} ${response.statusText}`);
      }
      const contentType = response.headers.get('content-type');
      if (contentType && (contentType.includes('png') || contentType.includes('jpeg') || contentType.includes('jpg'))) {
        mimeType = contentType.includes('png') ? 'image/png' : 'image/jpeg';
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      if (!existsSync(imageSource)) {
        throw new Error(`Arquivo não encontrado no caminho: ${imageSource}`);
      }
      console.log(`Lendo arquivo local:\n-> ${imageSource}`);
      buffer = readFileSync(imageSource);
      if (imageSource.toLowerCase().endsWith('.png')) {
        mimeType = 'image/png';
      } else {
        mimeType = 'image/jpeg';
      }
    }

    const sizeBytes = buffer.length;
    const hashSha256 = createHash('sha256').update(buffer).digest('hex');

    console.log(`Tamanho: ${(sizeBytes / 1024).toFixed(2)} KB (${sizeBytes} bytes)`);
    console.log(`MIME Type: ${mimeType}`);
    console.log(`SHA-256: ${hashSha256}`);

    // 2. Localizar o alerta de destino
    let alertId: bigint | undefined;

    if (target && /^\d+$/.test(target)) {
      alertId = BigInt(target);
    } else {
      // Localiza o usuário (por e-mail fornecido ou usuário ativo no banco)
      const user = target
        ? await prisma.user.findUnique({ where: { email: target } })
        : (await prisma.user.findFirst({
            where: {
              status: 'ATIVO',
              email: {
                not: {
                  startsWith: 'test.',
                },
                notIn: ['outro_morador_dev@poolsafe.app'],
              },
            },
            orderBy: { id: 'asc' },
          })) ??
          (await prisma.user.findFirst({
            where: { status: 'ATIVO' },
            orderBy: { id: 'asc' },
          }));

      if (!user) {
        throw new Error('Nenhum usuário ativo encontrado para associar o alerta.');
      }

      console.log(`Usuário selecionado: ${user.name} (${user.email})`);

      // Encontra o alerta mais recente do usuário
      const recipient = await prisma.alertRecipient.findFirst({
        where: { userId: user.id },
        orderBy: { alert: { detectedAt: 'desc' } },
        include: { alert: { include: { camera: true } } },
      });

      if (!recipient) {
        throw new Error(`Nenhum alerta encontrado para o usuário ${user.email}. Execute 'npm run seed:alerts' primeiro.`);
      }

      alertId = recipient.alertId;
      console.log(`Alerta selecionado: #${alertId} (${recipient.alert.camera.name} — ${recipient.alert.severity})`);
    }

    // 3. Atualiza ou insere a evidência com o blob real
    const expiresAt = new Date(Date.now() + 30 * 86_400_000); // 30 dias no futuro
    const uint8Content = new Uint8Array(buffer);
    await prisma.alertEvidence.upsert({
      where: { alertId },
      update: {
        content: uint8Content,
        sizeBytes: BigInt(sizeBytes),
        mimeType,
        hashSha256,
        expiresAt,
        removedAt: null,
      },
      create: {
        alertId,
        content: uint8Content,
        sizeBytes: BigInt(sizeBytes),
        mimeType,
        hashSha256,
        expiresAt,
        removedAt: null,
      },
    });

    console.log(`\n✅ Sucesso! O blob real foi gravado no banco de dados para o alerta #${alertId}.`);
    console.log('Agora abra o aplicativo PoolSafe no emulador, vá em Histórico e toque no alerta para visualizar a foto real!');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n❌ Erro:', err.message || err);
  process.exit(1);
});
