const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function testUpload() {
  console.log('Testing upload as Foreman...');
  
  const { data: createData, error: createError } = await supabase.rpc('admin_create_user', {
    p_username: 'testforeman123',
    p_role: 'Foreman'
  });
  
  if (createError) {
    console.error('Create User Error:', createError);
  } else {
    console.log('Created user testforeman123');
  }

  const email = 'testforeman123@buildtrack.local';
  const password = '1234BT!';
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  
  if (authError) {
    console.error('Auth Error:', authError);
    return;
  }
  console.log('Logged in as:', authData.user?.email);

  const { data: plots } = await supabase.from('plots').select('id').limit(1);
  if (!plots || plots.length === 0) {
    console.error('No plots found');
    return;
  }
  const plotId = plots[0].id;
  console.log('Plot ID:', plotId);
  
  const { data: updateData, error: updateError } = await supabase.from('plots').update({ overview_image_url: 'https://test.com/img.jpg' }).eq('id', plotId).select();
  
  if (updateError) {
    console.error('Plot Update Error:', updateError);
  } else {
    console.log('Plot Update Data:', updateData);
  }
  
  // Test storage upload
  console.log('Testing storage upload...');
  const { data: uploadData, error: uploadError } = await supabase.storage.from('task_images').upload('test.txt', 'test content', { upsert: true });
  if (uploadError) {
    console.error('Storage Upload Error:', uploadError);
  } else {
    console.log('Storage Upload Data:', uploadData);
  }
}

testUpload();
