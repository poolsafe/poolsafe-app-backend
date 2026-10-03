import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { HashService } from '../auth/hash.service.js';
import {
  AccessDeniedException,
  ResourceNotFoundException,
  ReauthenticationFailedException,
  MonitoringStateConflictException,
  CameraNotOperationalException,
} from '../../common/errors/problem-details.exception.js';
import {
  DEFAULT_CAMERA_OFFLINE_THRESHOLD_MS,
  resolveCameraConnectionStatus,
  calculateMonitoringOperationalState,
} from '../cameras/camera-connectivity.util.js';
import type { CreateMonitoringDto } from './dto/create-monitoring.dto.js';
import type { PauseMonitoringDto } from './dto/pause-monitoring.dto.js';
import type { EndMonitoringDto } from './dto/end-monitoring.dto.js';
import type {
  MonitoringItem,
  MonitoringResponse,
  CurrentMonitoringsResponse,
  MonitoringPersistedStatus,
} from './dto/monitoring-response.dto.js';

@Injectable()
export class MonitoringsService {
  private readonly logger = new Logger(MonitoringsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashService: HashService,
    private readonly configService: ConfigService,
  ) {}

  private getThresholdMs(): number {
    const thresholdSeconds =
      this.configService.get<number>('CAMERA_OFFLINE_THRESHOLD_SECONDS') ?? 90;
    return thresholdSeconds * 1000 || DEFAULT_CAMERA_OFFLINE_THRESHOLD_MS;
  }

  private parseBigInt(val: string): bigint | null {
    if (!/^\d+$/.test(val)) return null;
    try {
      return BigInt(val);
    } catch {
      return null;
    }
  }

  private mapMonitoringItem(
    monitoring: {
      id: bigint;
      status: string;
      startedAt: Date;
      pausedAt: Date | null;
      endedAt: Date | null;
      updatedAt: Date;
      monitoringCameras: Array<{
        camera: {
          id: bigint;
          name: string;
          administrativeStatus: string;
          lastCommunicationAt: Date | null;
        };
      }>;
    },
    now: Date,
    thresholdMs: number,
  ): MonitoringItem {
    const { operationalStatus, operationalReason } =
      calculateMonitoringOperationalState(monitoring, now, thresholdMs);

    const cameras = monitoring.monitoringCameras.map((mc) => ({
      id: mc.camera.id.toString(),
      name: mc.camera.name,
      connectionStatus: resolveCameraConnectionStatus(
        mc.camera,
        now,
        thresholdMs,
      ),
    }));

    return {
      id: monitoring.id.toString(),
      status: monitoring.status as MonitoringPersistedStatus,
      operationalStatus,
      operationalReason,
      cameras,
      startedAt: monitoring.startedAt.toISOString(),
      pausedAt: monitoring.pausedAt ? monitoring.pausedAt.toISOString() : null,
      endedAt: monitoring.endedAt ? monitoring.endedAt.toISOString() : null,
      updatedAt: monitoring.updatedAt.toISOString(),
    };
  }

  /**
   * GET /api/v1/monitorings/current
   * Retorna todas as sessões ATIVAS ou PAUSADAS nas quais o usuário possui acesso ativo a todas as câmeras.
   */
  async getCurrentMonitorings(
    userIdStr: string,
    requestId: string,
  ): Promise<CurrentMonitoringsResponse> {
    const prisma = this.prisma.getClient();
    const userBigInt = this.parseBigInt(userIdStr);
    if (!userBigInt) {
      return { data: [], meta: { requestId } };
    }

    const now = new Date();
    const thresholdMs = this.getThresholdMs();

    // 1. Obter todos os acessos ativos do usuário
    const userAccesses = await prisma.cameraAccess.findMany({
      where: {
        userId: userBigInt,
        active: true,
        revokedAt: null,
      },
      select: { cameraId: true },
    });
    const authorizedCameraIdSet = new Set(
      userAccesses.map((a) => a.cameraId.toString()),
    );

    // 2. Buscar monitoramentos ATIVOS ou PAUSADOS
    const monitorings = await prisma.monitoring.findMany({
      where: {
        status: { in: ['ATIVO', 'PAUSADO'] },
      },
      include: {
        monitoringCameras: {
          include: {
            camera: true,
          },
        },
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    // 3. Filtrar somente sessões em que o usuário possui acesso a TODAS as câmeras da sessão
    const authorizedMonitorings = monitorings.filter((m) => {
      if (m.monitoringCameras.length === 0) return false;
      return m.monitoringCameras.every((mc) =>
        authorizedCameraIdSet.has(mc.camera.id.toString()),
      );
    });

    const items = authorizedMonitorings.map((m) =>
      this.mapMonitoringItem(m, now, thresholdMs),
    );

    return {
      data: items,
      meta: { requestId },
    };
  }

  /**
   * GET /api/v1/monitorings/{monitoringId}
   * Retorna os detalhes de uma sessão autorizada. Se inexistente ou não autorizado, retorna 404 RESOURCE_NOT_FOUND.
   */
  async getMonitoringById(
    monitoringIdStr: string,
    userIdStr: string,
    requestId: string,
  ): Promise<MonitoringResponse> {
    const prisma = this.prisma.getClient();
    const monitoringBigInt = this.parseBigInt(monitoringIdStr);
    const userBigInt = this.parseBigInt(userIdStr);

    if (!monitoringBigInt || !userBigInt) {
      throw new ResourceNotFoundException('Monitoramento não encontrado.');
    }

    const monitoring = await prisma.monitoring.findUnique({
      where: { id: monitoringBigInt },
      include: {
        monitoringCameras: {
          include: {
            camera: true,
          },
        },
      },
    });

    if (!monitoring) {
      throw new ResourceNotFoundException('Monitoramento não encontrado.');
    }

    // Verificar se o usuário possui acesso ativo a TODAS as câmeras da sessão
    const sessionCameraIds = monitoring.monitoringCameras.map(
      (mc) => mc.camera.id,
    );
    if (sessionCameraIds.length === 0) {
      throw new ResourceNotFoundException('Monitoramento não encontrado.');
    }

    const userAccesses = await prisma.cameraAccess.findMany({
      where: {
        userId: userBigInt,
        cameraId: { in: sessionCameraIds },
        active: true,
        revokedAt: null,
      },
      select: { cameraId: true },
    });

    if (userAccesses.length !== sessionCameraIds.length) {
      // 404 indistinguível para preservar segurança e evitar enumeração
      throw new ResourceNotFoundException('Monitoramento não encontrado.');
    }

    const now = new Date();
    const thresholdMs = this.getThresholdMs();
    const item = this.mapMonitoringItem(monitoring, now, thresholdMs);

    return {
      data: item,
      meta: { requestId },
    };
  }

  /**
   * POST /api/v1/monitorings
   * Inicia nova sessão de monitoramento ou retorna a existente se idempotente.
   * Protegido contra corrida concorrente via transação e bloqueio de linhas no MySQL.
   */
  async startMonitoring(
    dto: CreateMonitoringDto,
    userIdStr: string,
    requestId: string,
  ): Promise<{ response: MonitoringResponse; isCreated: boolean }> {
    const userBigInt = this.parseBigInt(userIdStr);
    if (!userBigInt) {
      throw new AccessDeniedException('Usuário inválido.');
    }

    const now = new Date();
    const thresholdMs = this.getThresholdMs();

    // Normalizar e validar IDs numéricos
    const requestedCameraBigInts: bigint[] = [];
    const seenIds = new Set<string>();

    for (const idStr of dto.cameraIds) {
      if (seenIds.has(idStr)) {
        throw new MonitoringStateConflictException(
          'Identificadores duplicados na lista de câmeras.',
        );
      }
      seenIds.add(idStr);
      const bId = this.parseBigInt(idStr);
      if (!bId) {
        throw new CameraNotOperationalException(
          `Identificador de câmera inválido: ${idStr}`,
        );
      }
      requestedCameraBigInts.push(bId);
    }

    const prisma = this.prisma.getClient();

    return await prisma.$transaction(
      async (tx) => {
        // 1. Validação de Autorização: O usuário possui acesso ativo a TODAS as câmeras solicitadas?
        const activeAccesses = await tx.cameraAccess.findMany({
          where: {
            userId: userBigInt,
            cameraId: { in: requestedCameraBigInts },
            active: true,
            revokedAt: null,
          },
          select: { cameraId: true },
        });

        if (activeAccesses.length !== requestedCameraBigInts.length) {
          throw new AccessDeniedException(
            'Você não possui autorização ativa para uma ou mais câmeras solicitadas.',
          );
        }

        // 2. Bloqueio pessimista de concorrência (FOR UPDATE) para as câmeras
        await tx.$queryRaw`
          SELECT id FROM camera 
          WHERE id IN (${Prisma.join(requestedCameraBigInts)}) 
          FOR UPDATE
        `;

        // 3. Obter dados operacionais atuais das câmeras bloqueadas
        const cameras = await tx.camera.findMany({
          where: { id: { in: requestedCameraBigInts } },
        });

        if (cameras.length !== requestedCameraBigInts.length) {
          throw new CameraNotOperationalException(
            'Uma ou mais câmeras não foram encontradas no sistema.',
          );
        }

        // Todas precisam estar administrativamente ativas e online
        for (const cam of cameras) {
          if (cam.administrativeStatus !== 'ATIVA') {
            throw new CameraNotOperationalException(
              `A câmera "${cam.name}" está inativa administrativamente e não pode ser monitorada.`,
            );
          }
          const connStatus = resolveCameraConnectionStatus(cam, now, thresholdMs);
          if (connStatus !== 'ONLINE') {
            throw new CameraNotOperationalException(
              `A câmera "${cam.name}" está com status "${connStatus}" (não operacional) no momento.`,
            );
          }
        }

        // 4. Invariante: Câmeras precisam compartilhar exatamente o mesmo conjunto de usuários autorizados
        const allCameraAccesses = await tx.cameraAccess.findMany({
          where: {
            cameraId: { in: requestedCameraBigInts },
            active: true,
            revokedAt: null,
          },
          select: {
            cameraId: true,
            userId: true,
          },
        });

        const usersPerCamera = new Map<string, Set<string>>();
        for (const bId of requestedCameraBigInts) {
          usersPerCamera.set(bId.toString(), new Set<string>());
        }
        for (const acc of allCameraAccesses) {
          usersPerCamera.get(acc.cameraId.toString())?.add(acc.userId.toString());
        }

        const baseUsers = usersPerCamera.get(requestedCameraBigInts[0].toString())!;
        for (const [_camIdStr, userSet] of usersPerCamera.entries()) {
          if (userSet.size !== baseUsers.size) {
            throw new MonitoringStateConflictException(
              'As câmeras selecionadas não compartilham o mesmo conjunto de usuários autorizados.',
            );
          }
          for (const u of baseUsers) {
            if (!userSet.has(u)) {
              throw new MonitoringStateConflictException(
                'As câmeras selecionadas não compartilham o mesmo conjunto de usuários autorizados.',
              );
            }
          }
        }

        // 5. Verificar sessões não encerradas existentes que envolvam essas câmeras
        const existingSessionLinks = await tx.monitoringCamera.findMany({
          where: {
            cameraId: { in: requestedCameraBigInts },
            monitoring: {
              status: { in: ['ATIVO', 'PAUSADO'] },
            },
          },
          include: {
            monitoring: {
              include: {
                monitoringCameras: {
                  include: { camera: true },
                },
              },
            },
          },
        });

        if (existingSessionLinks.length > 0) {
          // Coletar as sessões únicas envolvidas
          const sessionsMap = new Map<
            string,
            typeof existingSessionLinks[0]['monitoring']
          >();
          for (const link of existingSessionLinks) {
            sessionsMap.set(link.monitoring.id.toString(), link.monitoring);
          }

          // Se houver mais de uma sessão ou sessão que não coincida exatamente na composição
          const requestedIdStrings = new Set(
            requestedCameraBigInts.map((id) => id.toString()),
          );

          if (sessionsMap.size === 1) {
            const singleSession = Array.from(sessionsMap.values())[0];
            const sessionCameraIdStrings = new Set(
              singleSession.monitoringCameras.map((mc) => mc.camera.id.toString()),
            );

            // Verifica se a composição é EXATAMENTE a mesma
            const sameComposition =
              requestedIdStrings.size === sessionCameraIdStrings.size &&
              Array.from(requestedIdStrings).every((id) =>
                sessionCameraIdStrings.has(id),
              );

            if (sameComposition && singleSession.status === 'ATIVO') {
              // Retorno idempotente 200 OK
              const item = this.mapMonitoringItem(
                singleSession,
                now,
                thresholdMs,
              );
              return {
                response: { data: item, meta: { requestId } },
                isCreated: false,
              };
            }
          }

          // Caso contrário, existe sobreposição ou conflito de composição/sessão pausada
          throw new MonitoringStateConflictException(
            'Uma ou mais câmeras já pertencem a outra sessão de monitoramento em andamento.',
          );
        }

        // 6. Criar nova sessão de monitoramento
        const newMonitoring = await tx.monitoring.create({
          data: {
            status: 'ATIVO',
            startedByUserId: userBigInt,
            startedAt: now,
          },
        });

        // 7. Associar câmeras da sessão
        await tx.monitoringCamera.createMany({
          data: requestedCameraBigInts.map((camId) => ({
            monitoringId: newMonitoring.id,
            cameraId: camId,
            addedAt: now,
          })),
        });

        // 8. Gravar evento de domínio INICIADO atomicamente
        await tx.monitoringEvent.create({
          data: {
            monitoringId: newMonitoring.id,
            userId: userBigInt,
            type: 'INICIADO',
            reason: 'Monitoramento iniciado pelo usuário.',
            occurredAt: now,
          },
        });

        const createdSession = await tx.monitoring.findUniqueOrThrow({
          where: { id: newMonitoring.id },
          include: {
            monitoringCameras: {
              include: { camera: true },
            },
          },
        });

        const item = this.mapMonitoringItem(
          createdSession,
          now,
          thresholdMs,
        );

        return {
          response: { data: item, meta: { requestId } },
          isCreated: true,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  /**
   * POST /api/v1/monitorings/{monitoringId}/pause
   * Pausa sessão ativa com reautenticação obrigatória por senha.
   * Senha verificada diretamente via Argon2id e NUNCA registrada em logs.
   */
  async pauseMonitoring(
    monitoringIdStr: string,
    dto: PauseMonitoringDto,
    userIdStr: string,
    requestId: string,
  ): Promise<MonitoringResponse> {
    const monitoringBigInt = this.parseBigInt(monitoringIdStr);
    const userBigInt = this.parseBigInt(userIdStr);

    if (!monitoringBigInt || !userBigInt) {
      throw new ResourceNotFoundException('Monitoramento não encontrado.');
    }

    const now = new Date();
    const thresholdMs = this.getThresholdMs();
    const prisma = this.prisma.getClient();

    return await prisma.$transaction(
      async (tx) => {
        // 1. Bloqueio pessimista da sessão para evitar corrida de pausas/retomadas
        await tx.$queryRaw`
          SELECT id FROM monitoramento 
          WHERE id = ${monitoringBigInt} 
          FOR UPDATE
        `;

        const monitoring = await tx.monitoring.findUnique({
          where: { id: monitoringBigInt },
          include: {
            monitoringCameras: {
              include: { camera: true },
            },
          },
        });

        if (!monitoring) {
          throw new ResourceNotFoundException('Monitoramento não encontrado.');
        }

        // 2. Verificar acesso ativo a TODAS as câmeras
        const sessionCameraIds = monitoring.monitoringCameras.map(
          (mc) => mc.camera.id,
        );
        const userAccesses = await tx.cameraAccess.findMany({
          where: {
            userId: userBigInt,
            cameraId: { in: sessionCameraIds },
            active: true,
            revokedAt: null,
          },
          select: { cameraId: true },
        });

        if (userAccesses.length !== sessionCameraIds.length) {
          throw new ResourceNotFoundException('Monitoramento não encontrado.');
        }

        // 3. Reautenticação reforçada: verificar senha do usuário
        const user = await tx.user.findUnique({
          where: { id: userBigInt },
          select: { passwordHash: true },
        });

        if (!user) {
          throw new ReauthenticationFailedException();
        }

        const isPasswordValid = await this.hashService.verify(
          user.passwordHash,
          dto.password,
        );

        if (!isPasswordValid) {
          throw new ReauthenticationFailedException(
            'A senha atual informada está incorreta.',
          );
        }

        // 4. Validar estado da sessão
        if (monitoring.status === 'ENCERRADO') {
          throw new MonitoringStateConflictException(
            'Não é possível pausar uma sessão de monitoramento já encerrada.',
          );
        }

        // Idempotência: se já estiver pausado, retorna 200 OK sem duplicar evento
        if (monitoring.status === 'PAUSADO') {
          const item = this.mapMonitoringItem(monitoring, now, thresholdMs);
          return { data: item, meta: { requestId } };
        }

        // 5. Aplicar transição para PAUSADO e criar evento PAUSADO atomicamente
        const updated = await tx.monitoring.update({
          where: { id: monitoringBigInt },
          data: {
            status: 'PAUSADO',
            pausedAt: now,
          },
          include: {
            monitoringCameras: {
              include: { camera: true },
            },
          },
        });

        await tx.monitoringEvent.create({
          data: {
            monitoringId: monitoringBigInt,
            userId: userBigInt,
            type: 'PAUSADO',
            reason: 'Monitoramento pausado pelo usuário após reautenticação.',
            occurredAt: now,
          },
        });

        const item = this.mapMonitoringItem(updated, now, thresholdMs);
        return { data: item, meta: { requestId } };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  /**
   * POST /api/v1/monitorings/{monitoringId}/resume
   * Retoma sessão pausada. Todas as câmeras da sessão devem estar ativas e online.
   */
  async resumeMonitoring(
    monitoringIdStr: string,
    userIdStr: string,
    requestId: string,
  ): Promise<MonitoringResponse> {
    const monitoringBigInt = this.parseBigInt(monitoringIdStr);
    const userBigInt = this.parseBigInt(userIdStr);

    if (!monitoringBigInt || !userBigInt) {
      throw new ResourceNotFoundException('Monitoramento não encontrado.');
    }

    const now = new Date();
    const thresholdMs = this.getThresholdMs();
    const prisma = this.prisma.getClient();

    return await prisma.$transaction(
      async (tx) => {
        // 1. Bloqueio pessimista da sessão
        await tx.$queryRaw`
          SELECT id FROM monitoramento 
          WHERE id = ${monitoringBigInt} 
          FOR UPDATE
        `;

        const monitoring = await tx.monitoring.findUnique({
          where: { id: monitoringBigInt },
          include: {
            monitoringCameras: {
              include: { camera: true },
            },
          },
        });

        if (!monitoring) {
          throw new ResourceNotFoundException('Monitoramento não encontrado.');
        }

        // 2. Verificar acesso ativo a TODAS as câmeras
        const sessionCameraIds = monitoring.monitoringCameras.map(
          (mc) => mc.camera.id,
        );
        const userAccesses = await tx.cameraAccess.findMany({
          where: {
            userId: userBigInt,
            cameraId: { in: sessionCameraIds },
            active: true,
            revokedAt: null,
          },
          select: { cameraId: true },
        });

        if (userAccesses.length !== sessionCameraIds.length) {
          throw new ResourceNotFoundException('Monitoramento não encontrado.');
        }

        // 3. Validar estado da sessão
        if (monitoring.status === 'ENCERRADO') {
          throw new MonitoringStateConflictException(
            'Não é possível retomar uma sessão de monitoramento já encerrada.',
          );
        }

        // Idempotência: se já estiver ATIVO, retorna 200 OK sem duplicar evento
        if (monitoring.status === 'ATIVO') {
          const item = this.mapMonitoringItem(monitoring, now, thresholdMs);
          return { data: item, meta: { requestId } };
        }

        // 4. Bloquear e verificar disponibilidade de todas as câmeras da sessão
        await tx.$queryRaw`
          SELECT id FROM camera 
          WHERE id IN (${Prisma.join(sessionCameraIds)}) 
          FOR UPDATE
        `;

        const cameras = await tx.camera.findMany({
          where: { id: { in: sessionCameraIds } },
        });

        for (const cam of cameras) {
          if (cam.administrativeStatus !== 'ATIVA') {
            throw new CameraNotOperationalException(
              `A câmera "${cam.name}" está inativa administrativamente e não pode ser monitorada.`,
            );
          }
          const connStatus = resolveCameraConnectionStatus(cam, now, thresholdMs);
          if (connStatus !== 'ONLINE') {
            throw new CameraNotOperationalException(
              `A câmera "${cam.name}" está com status "${connStatus}" (não operacional) no momento.`,
            );
          }
        }

        // 5. Atualizar sessão para ATIVO e gravar evento REATIVADO atomicamente
        const updated = await tx.monitoring.update({
          where: { id: monitoringBigInt },
          data: {
            status: 'ATIVO',
            pausedAt: null,
          },
          include: {
            monitoringCameras: {
              include: { camera: true },
            },
          },
        });

        await tx.monitoringEvent.create({
          data: {
            monitoringId: monitoringBigInt,
            userId: userBigInt,
            type: 'REATIVADO',
            reason: 'Monitoramento retomado pelo usuário.',
            occurredAt: now,
          },
        });

        const item = this.mapMonitoringItem(updated, now, thresholdMs);
        return { data: item, meta: { requestId } };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  /**
   * POST /api/v1/monitorings/{monitoringId}/end
   * Encerra a sessão de monitoramento definitivamente com reautenticação obrigatória por senha.
   * Libera todas as suas câmeras para novas sessões ou para ficarem livres.
   * Cria um único evento ENCERRADO atomicamente na transação.
   * Senha verificada diretamente via Argon2id e NUNCA registrada em logs.
   */
  async endMonitoring(
    monitoringIdStr: string,
    dto: EndMonitoringDto,
    userIdStr: string,
    requestId: string,
  ): Promise<MonitoringResponse> {
    const monitoringBigInt = this.parseBigInt(monitoringIdStr);
    const userBigInt = this.parseBigInt(userIdStr);

    if (!monitoringBigInt || !userBigInt) {
      throw new ResourceNotFoundException('Monitoramento não encontrado.');
    }

    const now = new Date();
    const thresholdMs = this.getThresholdMs();
    const prisma = this.prisma.getClient();

    return await prisma.$transaction(
      async (tx) => {
        // 1. Bloqueio pessimista da sessão
        await tx.$queryRaw`
          SELECT id FROM monitoramento 
          WHERE id = ${monitoringBigInt} 
          FOR UPDATE
        `;

        const monitoring = await tx.monitoring.findUnique({
          where: { id: monitoringBigInt },
          include: {
            monitoringCameras: {
              include: { camera: true },
            },
          },
        });

        if (!monitoring) {
          throw new ResourceNotFoundException('Monitoramento não encontrado.');
        }

        // 2. Verificar acesso ativo a TODAS as câmeras da sessão
        const sessionCameraIds = monitoring.monitoringCameras.map(
          (mc) => mc.camera.id,
        );
        const userAccesses = await tx.cameraAccess.findMany({
          where: {
            userId: userBigInt,
            cameraId: { in: sessionCameraIds },
            active: true,
            revokedAt: null,
          },
          select: { cameraId: true },
        });

        if (userAccesses.length !== sessionCameraIds.length) {
          throw new ResourceNotFoundException('Monitoramento não encontrado.');
        }

        // 3. Reautenticação reforçada: verificar senha do usuário
        const user = await tx.user.findUnique({
          where: { id: userBigInt },
          select: { passwordHash: true },
        });

        if (!user) {
          throw new ReauthenticationFailedException();
        }

        const isPasswordValid = await this.hashService.verify(
          user.passwordHash,
          dto.password,
        );

        if (!isPasswordValid) {
          throw new ReauthenticationFailedException(
            'A senha atual informada está incorreta.',
          );
        }

        // 4. Idempotência: se já encerrado, retorna 200 OK sem duplicar evento
        if (monitoring.status === 'ENCERRADO') {
          const item = this.mapMonitoringItem(monitoring, now, thresholdMs);
          return { data: item, meta: { requestId } };
        }

        // 5. Atualizar para ENCERRADO e gravar evento ENCERRADO atomicamente
        const updated = await tx.monitoring.update({
          where: { id: monitoringBigInt },
          data: {
            status: 'ENCERRADO',
            endedAt: now,
          },
          include: {
            monitoringCameras: {
              include: { camera: true },
            },
          },
        });

        await tx.monitoringEvent.create({
          data: {
            monitoringId: monitoringBigInt,
            userId: userBigInt,
            type: 'ENCERRADO',
            reason: 'Monitoramento encerrado pelo usuário após reautenticação.',
            occurredAt: now,
          },
        });

        const item = this.mapMonitoringItem(updated, now, thresholdMs);
        return { data: item, meta: { requestId } };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }
}
