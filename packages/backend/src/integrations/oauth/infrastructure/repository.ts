import { sql } from 'npm:drizzle-orm@0.45.4';
import { AppError } from '../../../../../contracts/mod.ts';
import type { Database } from '../../../platform/database/client.ts';
import { rows } from '../../../platform/database/query.ts';
import type { Authorization, Grant, OAuthRepository } from '../index.ts';
const denied = (): never => {
  throw new AppError(
    'forbidden',
    'Connection authorization expired, revoked or missing; reconnect to Roster',
  );
};
export function createOAuthRepository(db: Database): OAuthRepository {
  return {
    async saveAuthorization(a) {
      await db.execute(
        sql`insert into roster.oauth_authorizations(id,client_id,redirect_uri,state,access) values(${a.id},${a.clientId},${a.redirectUri},${
          a.state ?? null
        },${a.access})`,
      );
    },
    async authorization(id) {
      const result = await rows(
        db,
        sql`select id,client_id as "clientId",redirect_uri as "redirectUri",state,access from roster.oauth_authorizations where id=${id} and expires_at>now() and code_hash is null`,
      );
      return result[0] as Authorization | undefined ?? denied();
    },
    async approve(id, run) {
      return db.transaction(async (tx) => {
        const result = await rows(
          tx,
          sql`select id,client_id as "clientId",redirect_uri as "redirectUri",state,access from roster.oauth_authorizations where id=${id} and expires_at>now() and code_hash is null for update`,
        );
        const authorization = result[0] as Authorization | undefined ?? denied();
        const { approval: a, result: output } = await run(authorization);
        await tx.execute(
          sql`update roster.oauth_authorizations set code_hash=${a.codeHash},subject=${a.subject},workspace=${a.workspace},approved_access=${a.access} where id=${id}`,
        );
        return output;
      });
    },
    async cancel(id) {
      const result = await rows(
        db,
        sql`delete from roster.oauth_authorizations where id=${id} and expires_at>now() and code_hash is null returning id,client_id as "clientId",redirect_uri as "redirectUri",state,access`,
      );
      return result[0] as Authorization | undefined ?? denied();
    },
    async pending(codeHash) {
      const result = await rows(
        db,
        sql`select id as "authorizationId",code_hash as "codeHash",subject,client_id as "clientId",workspace,approved_access as access from roster.oauth_authorizations where code_hash=${codeHash} and expires_at>now() and consumed_at is null`,
      );
      return result[0] as Awaited<ReturnType<OAuthRepository['pending']>> | undefined ?? denied();
    },
    async bind(g, codeHash) {
      await db.transaction(async (tx) => {
        const a = await rows(
          tx,
          sql`update roster.oauth_authorizations set consumed_at=now() where code_hash=${codeHash} and consumed_at is null and expires_at>now() returning id`,
        );
        if (!a.length) denied();
        // Never update a session's workspace or permission on reauthorization.
        await tx.execute(
          sql`insert into roster.oauth_grants(session_id,subject,client_id,workspace,access) values(${g.sessionId},${g.subject},${g.clientId},${g.workspace},${g.access})`,
        );
      });
    },
    async grant(sessionId) {
      const result = await rows(
        db,
        sql`select session_id as "sessionId",subject,client_id as "clientId",workspace,access from roster.oauth_grants where session_id=${sessionId} and revoked_at is null`,
      );
      return result[0] as Grant | undefined ?? denied();
    },
  };
}
