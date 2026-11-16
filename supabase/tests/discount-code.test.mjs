import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const pgBin = '/usr/lib/postgresql/16/bin';
const pgEnv = {
  ...process.env,
  LC_ALL: 'en_US.UTF-8',
  LANG: 'en_US.UTF-8',
  PATH: `${pgBin}:${process.env.PATH ?? ''}`,
};

const memberId = 'e1111111-1111-4111-8111-111111111111';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('no port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function database() {
  const dir = await mkdtemp(join(tmpdir(), 'brew-discount-'));
  const port = await freePort();
  await exec(join(pgBin, 'initdb'), ['-D', dir, '--username=postgres', '--auth=trust', '--no-instructions'], { env: pgEnv });
  await exec(join(pgBin, 'pg_ctl'), ['-D', dir, '-l', join(dir, 'server.log'), '-o', `-p ${port} -k ${dir}`, 'start'], { env: pgEnv });

  const psql = async (statement) => {
    const { stdout } = await exec(join(pgBin, 'psql'), [
      '-h', dir,
      '-p', String(port),
      '-U', 'postgres',
      '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1',
      '-t', '-A',
      '-c', statement,
    ], { env: pgEnv });
    return stdout.trim();
  };

  await psql(`
    create schema if not exists auth;
    create schema if not exists extensions;
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
    end
    $$;
    create table auth.users (
      id uuid primary key,
      email text,
      email_confirmed_at timestamptz
    );
    create or replace function auth.uid() returns uuid
    language sql stable as $$ select null::uuid $$;
  `);

  const files = (await readdir('supabase/migrations')).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(join('supabase/migrations', file), 'utf8');
    await psql(sql);
  }

  const terms = await psql(`select version from public.legal_documents where kind = 'terms' and is_current`);
  const privacy = await psql(`select version from public.legal_documents where kind = 'privacy' and is_current`);
  await psql(`
    insert into auth.users (id, email, email_confirmed_at)
    values ('${memberId}', 'member@example.com', now());
    insert into public.members (
      id, first_name, display_name, terms_version, privacy_version, timezone, region
    )
    values (
      '${memberId}', 'Ada', 'Ada', '${terms}', '${privacy}', 'Europe/Dublin', 'IE'
    );
    insert into public.member_balances (member_id, balance) values ('${memberId}', 1000);
  `);

  const stop = async () => {
    await exec(join(pgBin, 'pg_ctl'), ['-D', dir, 'stop', '-m', 'fast'], { env: pgEnv });
  };

  return { psql, stop };
}

test('discount-code publish, redeem, inventory, and catalog', async () => {
  const { psql, stop } = await database();
  try {
    const partner = JSON.parse(await psql(`
      select private.admin_upsert_partner(
        null,
        'Online Outfit',
        'https://store.example/shop',
        'https://cdn.example/logo.png'
      );
    `));
    assert.equal(partner.ok, true);

    const created = JSON.parse(await psql(`
      select private.admin_upsert_discount_offer(
        null,
        '${partner.id}',
        'online-outfit-20',
        '20% offline',
        'Use at checkout on the partner store.',
        '20% off',
        4500,
        3600,
        400,
        3,
        null,
        null,
        '["Open the partner store","Enter your code at checkout","Enjoy"]'::jsonb,
        null
      );
    `));
    assert.equal(created.ok, true);
    assert.equal(created.status, 'draft');

    const blocked = JSON.parse(await psql(`
      select private.admin_set_discount_offer_status('${created.id}', 'active');
    `));
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'needs_codes');

    const upload = JSON.parse(await psql(`
      select private.admin_upload_discount_codes(
        '${created.id}',
        array['CODE-ONE', 'CODE-TWO', 'CODE-ONE', '  ', 'CODE-THREE']
      );
    `));
    assert.equal(upload.ok, true);
    assert.equal(upload.inserted, 3);
    assert.equal(upload.skipped, 2);
    assert.equal(upload.available, 3);

    const published = JSON.parse(await psql(`
      select private.admin_set_discount_offer_status('${created.id}', 'active');
    `));
    assert.equal(published.ok, true);
    assert.equal(published.status, 'active');

    const catalogCount = await psql(`
      select count(*)::text from public.catalog_offers where id = '${created.id}';
    `);
    assert.equal(catalogCount, '1');

    const venueInCatalog = await psql(`
      select count(*)::text from public.catalog_offers where offer_type <> 'discount_code';
    `);
    assert.equal(venueInCatalog, '0');

    const eligible = JSON.parse(await psql(`
      select private.redeem_discount_code_offer(
        '${memberId}',
        '${created.id}',
        null,
        false
      );
    `));
    assert.equal(eligible.ok, true);
    assert.equal(eligible.reason, 'eligible');
    assert.equal(eligible.store_url, 'https://store.example/shop');

    const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const redeemed = JSON.parse(await psql(`
      select private.redeem_discount_code_offer(
        '${memberId}',
        '${created.id}',
        '${requestId}',
        true
      );
    `));
    assert.equal(redeemed.ok, true);
    assert.equal(redeemed.reason, 'redeemed');
    assert.ok(['CODE-ONE', 'CODE-TWO', 'CODE-THREE'].includes(redeemed.code));
    assert.equal(redeemed.store_url, 'https://store.example/shop');
    assert.equal(redeemed.balance, 600);

    const again = JSON.parse(await psql(`
      select private.redeem_discount_code_offer(
        '${memberId}',
        '${created.id}',
        '${requestId}',
        true
      );
    `));
    assert.equal(again.code, redeemed.code);
    assert.equal(again.balance, 600);

    const snapshot = await psql(`
      select fulfillment_code || '|' || coalesce(store_url, '')
      from public.redemptions
      where id = '${redeemed.redemption_id}';
    `);
    assert.equal(snapshot, `${redeemed.code}|https://store.example/shop`);

    const inventory = JSON.parse(await psql(`
      select private.admin_discount_offer_inventory('${created.id}');
    `));
    assert.equal(inventory.available, 2);
    assert.equal(inventory.assigned, 1);
    assert.equal(inventory.total, 3);

    const globalDup = JSON.parse(await psql(`
      select private.admin_upload_discount_codes(
        '${created.id}',
        array['CODE-TWO']
      );
    `));
    assert.equal(globalDup.inserted, 0);
    assert.equal(globalDup.skipped, 1);

    const paused = JSON.parse(await psql(`
      select private.admin_set_discount_offer_status('${created.id}', 'paused');
    `));
    assert.equal(paused.ok, true);
    const draftAgain = JSON.parse(await psql(`
      select private.admin_set_discount_offer_status('${created.id}', 'draft');
    `));
    assert.equal(draftAgain.ok, false);
    assert.equal(draftAgain.reason, 'cannot_draft_after_publish');
  } finally {
    await stop();
  }
});
