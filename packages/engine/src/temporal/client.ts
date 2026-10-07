import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';
import type { Env } from '../env';
import { createLogger } from '../util';
import { SIGNALS, WORKFLOWS, type ApprovalDecisionMsg } from './shared';

// Cliente Temporal usado pela API: inicia missões, manda sinais (pânico,
// aprovações) e cancela. Conexão preguiçosa com reconexão.

const log = createLogger('temporal');

export class OfficeTemporal {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  connected = false;

  constructor(private readonly env: Env) {}

  private async get(): Promise<Client> {
    if (this.client) return this.client;
    this.connecting ??= (async () => {
      const connection = await Connection.connect({ address: this.env.temporal.address, connectTimeout: '3s' });
      this.client = new Client({ connection, namespace: this.env.temporal.namespace });
      this.connected = true;
      return this.client;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = null;
    this.connected = false;
    await c?.connection.close().catch(() => undefined);
  }

  async ping(): Promise<boolean> {
    try {
      const c = await this.get();
      await c.workflowService.getSystemInfo({});
      this.connected = true;
    } catch {
      this.connected = false;
      this.client = null;
    }
    return this.connected;
  }

  async startMission(missionId: string): Promise<string> {
    const c = await this.get();
    const workflowId = `mission-${missionId}`;
    await c.workflow.start(WORKFLOWS.mission, {
      taskQueue: this.env.temporal.taskQueue,
      workflowId,
      args: [{ missionId }],
    });
    return workflowId;
  }

  async signal(workflowId: string, signal: string, ...args: unknown[]): Promise<boolean> {
    try {
      const c = await this.get();
      await c.workflow.getHandle(workflowId).signal(signal, ...args);
      return true;
    } catch (err) {
      if (!(err instanceof WorkflowNotFoundError)) log.warn(`sinal ${signal} → ${workflowId} falhou: ${(err as Error).message}`);
      return false;
    }
  }

  async approval(workflowId: string, msg: ApprovalDecisionMsg): Promise<boolean> {
    return this.signal(workflowId, SIGNALS.approval, msg);
  }

  async pause(workflowIds: string[]): Promise<void> {
    await Promise.all(workflowIds.map((id) => this.signal(id, SIGNALS.pause)));
  }

  async resume(workflowIds: string[]): Promise<void> {
    await Promise.all(workflowIds.map((id) => this.signal(id, SIGNALS.resume)));
  }

  async cancel(workflowId: string): Promise<void> {
    const c = await this.get();
    await c.workflow.getHandle(workflowId).cancel();
  }

  async status(workflowId: string): Promise<unknown> {
    try {
      const c = await this.get();
      return await c.workflow.getHandle(workflowId).query('status');
    } catch {
      return null;
    }
  }
}
