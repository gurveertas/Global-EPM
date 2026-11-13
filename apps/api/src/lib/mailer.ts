import nodemailer from "nodemailer";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { env } from "./env";
import { logger } from "./logger";
import type { EmailJob } from "./queue";

let smtp: nodemailer.Transporter | null = null;
let ses: SESv2Client | null = null;

/** Sends one email through SES, SMTP, or the log (development). Called by the worker. */
export async function sendEmail(job: EmailJob) {
  const from = job.fromName ? `${job.fromName} <${env.MAIL_FROM.match(/<(.+)>/)?.[1] ?? env.MAIL_FROM}>` : env.MAIL_FROM;
  if (env.MAIL_TRANSPORT === "log") {
    logger.info({ to: job.to, subject: job.subject, text: job.text.slice(0, 500), attachments: job.attachments?.map((a) => a.filename) }, "email (log transport)");
    return;
  }
  if (!smtp) {
    if (env.MAIL_TRANSPORT === "smtp") smtp = nodemailer.createTransport(env.SMTP_URL);
    else {
      ses ??= new SESv2Client({ region: env.AWS_REGION });
      smtp = nodemailer.createTransport({ SES: { sesClient: ses, SendEmailCommand } } as any);
    }
  }
  await smtp.sendMail({
    from, to: job.to, subject: job.subject, text: job.text, html: job.html,
    attachments: job.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.contentBase64, "base64"), contentType: a.contentType })),
  });
}
