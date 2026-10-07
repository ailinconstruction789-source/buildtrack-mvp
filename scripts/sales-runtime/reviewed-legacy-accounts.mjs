// Read-only source review from BuildTrack on 2026-09-25. No connection, credentials,
// customer rows or execution here. Only the owned synthetic runner compiles these.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const reviewedAccountHashes = Object.freeze({
    admin_create_user: '593070e451a2036ed495412746ef1935',
    admin_delete_user: '2ae0d7399cc64acdfbf477848ed07ed7',
    admin_change_username: '7709b2ea932a93568ffe665af6e92d34',
    admin_change_user_password: '93ae247abcfa2b517e76fc2bbfa1190b',
});

// Unlike change_username.sql, the installed version has no comments or redundant
// EXCEPTION WHEN OTHERS THEN RAISE block. Preserve exact spaces/newlines for its
// observed pg_proc.prosrc fingerprint. No production function is replaced here.
const renameBody = [
    '', 'DECLARE', '    v_user_id UUID;', '    v_old_email TEXT;', '    v_new_email TEXT;', 'BEGIN',
    "    IF trim(p_new_username) = '' THEN",
    "        RAISE EXCEPTION 'Username cannot be empty';", '    END IF;', '',
    "    v_old_email := LOWER(REPLACE(p_old_username, ' ', '')) || '@buildtrack.local';",
    "    v_new_email := LOWER(REPLACE(p_new_username, ' ', '')) || '@buildtrack.local';", '',
    '    SELECT id INTO v_user_id FROM auth.users WHERE email = v_old_email;', '',
    '    IF v_user_id IS NOT NULL THEN',
    '        IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_new_email) THEN',
    "            RAISE EXCEPTION 'This username already exists';", '        END IF;', '',
    '        UPDATE auth.users ', '        SET email = v_new_email, ',
    "            raw_user_meta_data = jsonb_set(raw_user_meta_data, '{username}', to_jsonb(p_new_username))",
    '        WHERE id = v_user_id;', '', '        UPDATE auth.identities',
    "        SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_new_email))",
    '        WHERE user_id = v_user_id;', '    END IF;', '',
    '    UPDATE public.users SET username = p_new_username WHERE username = p_old_username;',
    '    UPDATE public.foremen SET name = p_new_username WHERE name = p_old_username;',
    '    UPDATE public.task_updates SET user_name = p_new_username WHERE user_name = p_old_username;',
    '    UPDATE public.defects SET reported_by = p_new_username WHERE reported_by = p_old_username;',
    '    UPDATE public.assignments SET user_name = p_new_username WHERE user_name = p_old_username;',
    '    UPDATE public.task_material_requests SET requested_by = p_new_username WHERE requested_by = p_old_username;',
    'END;', '',
].join('\r\n');

export function reviewedLegacyAccountFunctions(texts) {
    const all = [...(texts.get('sync_auth_users.sql').match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g) ?? []),
        ...(texts.get('fix_auth_users.sql').match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g) ?? [])];
    assert.equal(all.length, 4, 'Unexpected legacy source shape');
    const functions = new Map();
    for (const source of all) {
        const name = source.match(/^CREATE OR REPLACE FUNCTION\s+(\w+)/)?.[1];
        functions.set(name, source.replace(/\r?\n/g, '\r\n'));
    }
    functions.set('admin_change_username', `CREATE OR REPLACE FUNCTION admin_change_username(p_old_username TEXT,p_new_username TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$${renameBody}$$;`);
    assert.equal(functions.size, 4);
    const normalizedHashes = {};
    for (const [name, source] of functions) {
        const body = source.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1];
        assert.equal(createHash('md5').update(body ?? '').digest('hex'), reviewedAccountHashes[name], `Unreviewed legacy body: ${name}`);
        // psql normalizes stdin CRLF to LF before sending it to Postgres.
        normalizedHashes[name] = createHash('md5').update(body.replace(/\r\n/g,'\n')).digest('hex');
    }
    return { sql: [...functions.values()].join('\n'), hashes: reviewedAccountHashes, normalizedHashes };
}
