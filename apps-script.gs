// ================================================================
// Google Apps Script — Contact Form Backend
//
// 部署步骤（2 分钟）：
// 1. 打开 https://script.google.com
// 2. 新建项目，把这段代码完整粘贴进去
// 3. 把下面 YOUR_EMAIL 替换成你的真实邮箱（QQ/163/Gmail 都可以）
// 4. 点击「部署」→「新建部署」→ 类型选「网页应用」
//    访问权限选「所有人」、执行身份选「我自己」
// 5. 复制部署后的 URL，填入 js/contact.js 的 FORM_ENDPOINT
// ================================================================

var RECIPIENT_EMAIL = '2443852986@qq.com';

function doPost(e) {
  var data, name, email, message;

  try {
    data = JSON.parse(e.postData.contents);
    name = String(data.name || '').trim();
    email = String(data.email || '').trim();
    message = String(data.message || '').trim();
  } catch (err) {
    return json({ success: false, error: 'Invalid request data.' });
  }

  if (!name || !email || !message) {
    return json({ success: false, error: 'All fields are required.' });
  }

  var subject = 'Portfolio Contact — ' + name;
  var body = [
    'You received a new message from your portfolio site.',
    '',
    'Name:    ' + name,
    'Email:   ' + email,
    '',
    'Message:',
    message
  ].join('\n');

  try {
    GmailApp.sendEmail(RECIPIENT_EMAIL, subject, body, {
      replyTo: email,
      name: 'Portfolio Contact Form'
    });
    return json({ success: true });
  } catch (err) {
    return json({ success: false, error: 'Failed to send email. ' + err.message });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// 跨域支持 — 首次部署后需要重新部署才能生效
function doGet(e) {
  return json({ success: true, info: 'Contact form endpoint is running.' });
}
