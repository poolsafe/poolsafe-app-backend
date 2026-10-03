import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface SendPasswordResetEmailOptions {
  to: string;
  code: string;
  ttlMinutes: number;
}

export interface IEmailService {
  sendPasswordResetEmail(options: SendPasswordResetEmailOptions): Promise<boolean>;
}

@Injectable()
export class EmailService implements IEmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resendClient: Resend | null = null;
  private readonly fromEmail: string;
  private readonly logoUrl?: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.fromEmail =
      this.configService.get<string>('EMAIL_FROM') ||
      'PoolSafe <nao-responda@send.poolsafe.app>';
    this.logoUrl = this.configService.get<string>('EMAIL_LOGO_URL');

    if (apiKey && apiKey.trim().length > 0 && !apiKey.startsWith('<')) {
      this.resendClient = new Resend(apiKey.trim());
    } else {
      this.logger.warn(
        'RESEND_API_KEY não configurada ou com placeholder. O envio real de e-mails estará desabilitado (modo seguro/mock).',
      );
    }
  }

  /**
   * Renderiza o template HTML e texto plano e envia o e-mail de recuperação de senha pelo Resend.
   * Em caso de falha do provedor, lança erro para que o chamador possa invalidar o token gerado.
   * NUNCA registra a chave do Resend, código ou dados sensíveis em logs.
   */
  async sendPasswordResetEmail(options: SendPasswordResetEmailOptions): Promise<boolean> {
    const { to, code, ttlMinutes } = options;

    const html = this.buildHtmlTemplate(code, ttlMinutes);
    const text = this.buildTextTemplate(code, ttlMinutes);

    if (!this.resendClient) {
      this.logger.warn(
        'Tentativa de envio de e-mail sem cliente Resend ativo. Simulação de envio concluída.',
      );
      return true;
    }

    try {
      const response = await this.resendClient.emails.send({
        from: this.fromEmail,
        to,
        subject: 'PoolSafe — Redefinição de senha',
        html,
        text,
      });

      if (response.error) {
        this.logger.error(
          { errorCode: response.error.name, errorMessage: response.error.message },
          'Falha reportada pelo provedor Resend no envio de e-mail de recuperação.',
        );
        return false;
      }

      this.logger.log('E-mail de recuperação de senha despachado com sucesso via Resend.');
      return true;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      this.logger.error(
        { errorMessage },
        'Exceção operacional ao comunicar com a API do Resend.',
      );
      return false;
    }
  }

  /**
   * Constrói o template HTML inline compatível com os clientes de e-mail.
   * Utiliza design coerente com o PoolSafe: azul-marinho, azul profundo, destaque ciano.
   */
  public buildHtmlTemplate(code: string, ttlMinutes: number): string {
    const logoBlock =
      this.logoUrl && this.logoUrl.trim().length > 0
        ? `<tr>
            <td align="center" style="padding-bottom: 16px;">
              <img src="${this.escapeHtml(this.logoUrl)}" alt="PoolSafe" width="130" style="display: block; max-width: 130px; height: auto; border: 0;" />
            </td>
          </tr>`
        : '';

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Redefinição de senha — PoolSafe</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0B192C; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0B192C; padding: 32px 16px;">
    <tr>
      <td align="center">
        <!-- Cartão Container Principal -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; background-color: #1E3E62; border: 1px solid #2E5A88; border-radius: 12px; overflow: hidden; padding: 32px 24px;">
          ${logoBlock}
          <tr>
            <td align="center" style="padding-bottom: 8px;">
              <span style="color: #008DDA; font-size: 26px; font-weight: 700; letter-spacing: 0.5px; text-decoration: none;">PoolSafe</span>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom: 20px;">
              <h1 style="color: #F1F5F9; font-size: 20px; font-weight: 600; margin: 0; text-align: center;">Redefinição de senha</h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 24px;">
              <p style="color: #CBD5E1; font-size: 15px; line-height: 22px; margin: 0; text-align: center;">
                Recebemos uma solicitação para redefinir a senha da sua conta no PoolSafe. Utilize o código de verificação abaixo no aplicativo:
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="background-color: #0B192C; border: 2px solid #008DDA; border-radius: 8px; width: 100%; max-width: 320px;">
                <tr>
                  <td align="center" style="padding: 16px 20px;">
                    <span style="color: #38BDF8; font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: 700; letter-spacing: 4px; display: inline-block;">${this.escapeHtml(code)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 24px;">
              <p style="color: #94A3B8; font-size: 13px; line-height: 20px; margin: 0; text-align: center;">
                Este código é válido por <strong>${ttlMinutes} minutos</strong> e pode ser utilizado apenas uma vez.
              </p>
            </td>
          </tr>
          <tr>
            <td style="border-top: 1px solid #2E5A88; padding-top: 20px;">
              <p style="color: #94A3B8; font-size: 12px; line-height: 18px; margin: 0 0 10px; text-align: center;">
                Se você não realizou esta solicitação, por favor ignore esta mensagem. Sua senha atual permanecerá segura e inalterada.
              </p>
              <p style="color: #64748B; font-size: 11px; line-height: 16px; margin: 0; text-align: center;">
                <strong>Aviso de segurança:</strong> O PoolSafe nunca solicita sua senha ou este código por e-mail, telefone ou mensagens externas.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Constrói a versão textual do e-mail para leitores e clientes sem suporte a HTML.
   */
  public buildTextTemplate(code: string, ttlMinutes: number): string {
    return `PoolSafe — Redefinição de senha

Recebemos uma solicitação para redefinir a senha da sua conta no PoolSafe.
Utilize o código de verificação abaixo no aplicativo:

${code}

Este código é válido por ${ttlMinutes} minutos e pode ser utilizado apenas uma vez.

Se você não solicitou esta redefinição, por favor ignore esta mensagem. Sua senha permanecerá inalterada.

Aviso de segurança: O PoolSafe nunca solicita sua senha ou código por e-mail.`;
  }

  private escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
