const nodemailer = require('nodemailer');

// Helper to get settings dynamically from the database
async function getSetting(prisma, key, defaultValue) {
  try {
    const setting = await prisma.setting.findUnique({ where: { key } });
    return setting ? setting.value : defaultValue;
  } catch (err) {
    console.error(`Error getting setting ${key}:`, err);
    return defaultValue;
  }
}

/**
 * Sends a confirmation email to the customer after order placement.
 */
async function sendOrderConfirmationEmail(prisma, order) {
  try {
    const to = order.customerEmail;
    if (!to || !to.includes('@')) {
      console.log(`Skipping order confirmation email: Invalid email "${to}"`);
      return false;
    }

    const host = await getSetting(prisma, 'smtp_host', 'smtp.gmail.com');
    const port = parseInt(await getSetting(prisma, 'smtp_port', '587'), 10);
    const secureSetting = await getSetting(prisma, 'smtp_secure', 'false');
    const secure = secureSetting === 'true';
    const user = await getSetting(prisma, 'smtp_user', '');
    const pass = await getSetting(prisma, 'smtp_pass', '');
    const fromEmail = await getSetting(prisma, 'from_email', user);
    const fromName = await getSetting(prisma, 'from_name', 'The VitaHub');
    const whatsappNumber = await getSetting(prisma, 'whatsapp_number', '01201450111');
    const receivingNumber = await getSetting(prisma, 'receiving_number', '01009596452');
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://the-vitahub.com';

    if (!user || !pass) {
      console.log('SMTP settings not fully configured (user/pass missing). Email skipped.');
      return false;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
    });

    const itemsHtml = order.items.map(item => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #edf2f7; font-weight: bold; color: #2d3748; text-align: right;">
          ${item.title}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #edf2f7; text-align: center; color: #4a5568;">
          ${item.quantity}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #edf2f7; text-align: left; font-weight: bold; color: #10b981;">
          ${item.price} ج.م
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #edf2f7; text-align: left; font-weight: bold; color: #10b981;">
          ${item.price * item.quantity} ج.م
        </td>
      </tr>
    `).join('');

    let paymentInstructions = '';
    if (order.paymentMethod === 'instapay' || order.paymentMethod === 'wallet') {
      const waLink = `https://wa.me/20${whatsappNumber.replace(/^0/, '')}?text=${encodeURIComponent(`تم تحويل مبلغ ${order.total} ج.م لطلب جديد رقم #${order.orderNumber} باسم: ${order.customerName}`)}`;
      paymentInstructions = `
        <div style="margin-top: 24px; padding: 20px; background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px; text-align: right; direction: rtl;">
          <h4 style="margin: 0 0 10px 0; color: #b45309; font-size: 16px;">⚠️ تعليمات الدفع وإرسال الإيصال</h4>
          <p style="margin: 0 0 12px 0; color: #d97706; font-size: 14px; line-height: 1.6;">
            يرجى تحويل مبلغ <strong>${order.total} ج.م</strong> إلى الرقم التالي عبر تطبيق <strong>إنستاباي (Instapay)</strong> أو أي محفظة إلكترونية (فودافون كاش، إلخ):
          </p>
          <div style="background-color: #ffffff; padding: 12px; border: 1px solid #fde68a; border-radius: 8px; text-align: center; font-size: 18px; font-weight: bold; color: #78350f; letter-spacing: 1px; margin-bottom: 15px;">
            ${receivingNumber}
          </div>
          <p style="margin: 0 0 15px 0; color: #d97706; font-size: 13px; line-height: 1.5;">
            بعد التحويل، يرجى إرسال صورة إيصال التأكيد عبر الواتساب لتفعيل وشحن طلبك في أسرع وقت.
          </p>
          <div style="text-align: center;">
            <a href="${waLink}" target="_blank" style="display: inline-block; background-color: #25d366; color: #ffffff; padding: 12px 24px; border-radius: 8px; font-weight: bold; text-decoration: none; font-size: 14px; box-shadow: 0 4px 6px rgba(37, 211, 102, 0.15);">
              إرسال الإيصال عبر الواتساب 💬
            </a>
          </div>
        </div>
      `;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f7fafc; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
          .header { background-color: #064e3b; color: #ffffff; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 800; }
          .header p { margin: 5px 0 0 0; font-size: 12px; opacity: 0.8; font-weight: bold; }
          .content { padding: 30px; text-align: right; direction: rtl; }
          .greeting { font-size: 18px; font-weight: bold; color: #1a202c; margin-bottom: 10px; }
          .message { font-size: 14px; color: #4a5568; line-height: 1.6; margin-bottom: 25px; }
          .details-card { background-color: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 25px; border: 1px solid #edf2f7; }
          .details-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; color: #4a5568; }
          .details-label { font-weight: bold; color: #718096; }
          .details-value { font-weight: bold; color: #2d3748; }
          .table-container { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
          .table-header { background-color: #f8fafc; color: #718096; font-size: 11px; text-transform: uppercase; font-weight: 800; }
          .table-header th { padding: 12px; text-align: right; border-bottom: 2px solid #edf2f7; }
          .summary-row { font-size: 14px; font-weight: bold; color: #2d3748; }
          .summary-label { padding: 12px; text-align: right; color: #718096; }
          .summary-value { padding: 12px; text-align: left; }
          .total-row { font-size: 18px; font-weight: 800; color: #064e3b; background-color: #f0fdf4; }
          .footer { background-color: #f8fafc; padding: 20px; text-align: center; font-size: 11px; color: #a0aec0; border-top: 1px solid #edf2f7; }
          .footer a { color: #10b981; text-decoration: none; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1><a href="${siteUrl}" style="color: #ffffff; text-decoration: none;">The VitaHub</a></h1>
            <p>مكملات غذائية وفيتامينات أصلية 100%</p>
          </div>
          <div class="content">
            <div class="greeting">مرحباً ${order.customerName}،</div>
            <div class="message">
              تم استلام طلبك بنجاح وجاري العمل على تجهيزه وشحنه إليك في أقرب وقت. إليك تفاصيل فاتورة طلبك:
            </div>

            <div class="details-card">
              <div class="details-row">
                <span class="details-label">رقم الطلب:</span>
                <span class="details-value">#${order.orderNumber}</span>
              </div>
              <div class="details-row">
                <span class="details-label">تاريخ الطلب:</span>
                <span class="details-value">${new Date(order.createdAt).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              </div>
              <div class="details-row">
                <span class="details-label">العنوان:</span>
                <span class="details-value">${order.governorate} - ${order.district} - ${order.address}</span>
              </div>
              <div class="details-row">
                <span class="details-label">الهاتف:</span>
                <span class="details-value">${order.customerPhone}</span>
              </div>
            </div>

            <table class="table-container">
              <thead>
                <tr class="table-header">
                  <th style="text-align: right;">المنتج</th>
                  <th style="text-align: center; width: 60px;">الكمية</th>
                  <th style="text-align: left; width: 100px;">السعر</th>
                  <th style="text-align: left; width: 100px;">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
                <tr class="summary-row">
                  <td colspan="2" class="summary-label">الشحن والتوصيل:</td>
                  <td colspan="2" style="padding: 12px; text-align: left; color: #10b981;">
                    ${order.shippingFee === 0 ? 'مجاني' : `${order.shippingFee} ج.م`}
                  </td>
                </tr>
                <tr class="total-row">
                  <td colspan="2" style="padding: 15px; text-align: right;">الإجمالي النهائي:</td>
                  <td colspan="2" style="padding: 15px; text-align: left;">
                    ${order.total} ج.م
                  </td>
                </tr>
              </tbody>
            </table>

            ${paymentInstructions}
          </div>
          <div class="footer">
            <p>شكراً لتسوقك من <a href="${siteUrl}" style="color: #10b981; text-decoration: none; font-weight: bold;">The VitaHub</a>.</p>
            <p>إذا كان لديك أي استفسار، يمكنك دائماً التواصل معنا عبر الواتساب على رقم <a href="https://wa.me/20${whatsappNumber.replace(/^0/, '')}">+20${whatsappNumber.substring(1)}</a></p>
          </div>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject: `تأكيد طلبك من The VitaHub (#${order.orderNumber})`,
      html: htmlContent
    });
    console.log(`Order confirmation email sent successfully to ${to}`);
    return true;
  } catch (err) {
    console.error('Error sending order confirmation email:', err);
    return false;
  }
}

/**
 * Sends a test email to verify SMTP credentials.
 */
async function sendTestEmail(settings, toEmail) {
  const host = settings.smtp_host || 'smtp.gmail.com';
  const port = parseInt(settings.smtp_port || '587', 10);
  const secure = settings.smtp_secure === 'true';
  const user = settings.smtp_user;
  const pass = settings.smtp_pass;
  const fromEmail = settings.from_email || user;
  const fromName = settings.from_name || 'The VitaHub';

  if (!user || !pass) {
    throw new Error('اسم المستخدم أو كلمة المرور الخاصة بـ SMTP غير مدخلة.');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: toEmail,
    subject: 'رسالة تجريبية من لوحة تحكم The VitaHub',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; text-align: right; direction: rtl;">
        <h2 style="color: #10b981; text-align: center;">اتصال SMTP ناجح! 🎉</h2>
        <p style="font-size: 14px; color: #4a5568; line-height: 1.6;">
          مرحباً، هذه رسالة تجريبية تم إرسالها من لوحة تحكم <strong>The VitaHub</strong> لتأكيد أن إعدادات خادم البريد SMTP تعمل بشكل صحيح وسليم تماماً.
        </p>
        <hr style="border: 0; border-top: 1px solid #edf2f7; margin: 20px 0;" />
        <div style="font-size: 12px; color: #a0aec0; text-align: center;" dir="ltr">
          Mail Server: ${host}:${port} • Secure: ${secure ? 'SSL' : 'TLS'} • User: ${user}
        </div>
      </div>
    `
  });
}

module.exports = {
  sendOrderConfirmationEmail,
  sendTestEmail
};
