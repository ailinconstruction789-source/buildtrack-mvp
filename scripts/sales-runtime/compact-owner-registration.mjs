// Equivalent immutable-job registration with the approved JSON literal once.
// No connection, decoding, payload change, business writes or guard removal.
export function compactOwnerRegistration(sql){
 const prefix='WITH registered AS (SELECT sales_operator_private.register_job(';
 if(!sql.startsWith(prefix))throw Error('EXACT_OWNER_REGISTRATION_SQL_REQUIRED');
 let at=prefix.length;if(sql[at]!=="'")throw Error('OWNER_JSON_LITERAL_REQUIRED');
 const start=at++;
 while(at<sql.length){if(sql[at]==="'"){at++;if(sql[at]==="'"){at++;continue;}break;}at++;}
 if(sql.slice(at,at+7)!=='::jsonb')throw Error('OWNER_JSON_LITERAL_REQUIRED');at+=7;
 const literal=sql.slice(start,at);
 const expected=`WITH registered AS (SELECT sales_operator_private.register_job(${literal},sales_operator_private.digest(${literal})) AS id)
 SELECT jsonb_build_object('jobId',id,'payloadSha256',sales_operator_private.digest(${literal})) FROM registered;`;
 if(sql!==expected)throw Error('EXACT_OWNER_REGISTRATION_SQL_REQUIRED');
 return `WITH payload AS (SELECT ${literal} AS value),registered AS
 (SELECT sales_operator_private.register_job(value,sales_operator_private.digest(value)) AS id FROM payload)
 SELECT jsonb_build_object('jobId',id,'payloadSha256',sales_operator_private.digest(value)) FROM registered CROSS JOIN payload;`;
}
