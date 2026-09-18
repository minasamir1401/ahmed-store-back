const { Resend } = require('resend');

async function getSetting(prisma, key, defaultValue) {
  try {
    const setting = await prisma.setting.findUnique({ where: { key } });
    return setting && setting.value ? setting.value : defaultValue;
  } catch (err) {
    console.error(`Error getting setting ${key}:`, err);
    return defaultValue;
  }
}

async function sendViaResend({ apiKey, fromEmail, fromName, to, subject, html }) {
  const senderAddress = fromEmail || 'orders@the-vitahub.com';
  const senderDisplayName = fromName || 'The VitaHub';
  const from = `"${senderDisplayName}" <${senderAddress}>`;
  const recipients = Array.isArray(to) ? to : [to];

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: recipients,
      subject,
      html
    });

    if (error) {
      throw new Error(error.message || 'Resend SDK error');
    }
    return data;
  } catch (sdkError) {
    const isDomainPending = sdkError.message && sdkError.message.includes('domain is not verified');
    const isOwnerRecipient = recipients.some(r => {
      const lower = String(r).toLowerCase();
      return lower.includes('the.vitaminshub@gmail.com') || lower.includes('mina15g4y@gmail.com');
    });

    if (isDomainPending && isOwnerRecipient && !from.includes('onboarding@resend.dev')) {
      console.warn('Custom domain is pending Resend verification; using onboarding@resend.dev bridge for owner recipient...');
      const fallbackFrom = `"${senderDisplayName}" <onboarding@resend.dev>`;
      const { data, error } = await resend.emails.send({
        from: fallbackFrom,
        to: recipients,
        subject,
        html
      });
      if (!error && data) {
        return data;
      }
    }

    console.warn(`Resend SDK call encountered: ${sdkError.message}. Attempting direct Resend REST API...`);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        html
      })
    });

    const data = await response.json();
    if (!response.ok) {
      if (isDomainPending) {
        throw new Error('نطاق the-vitahub.com قيد التحقق حالياً في لوحة تحكم Resend. يرجى الانتظار لاكتمال انتشار DNS أو النقر على Verify Domain في لوحة تحكم Resend.');
      }
      throw new Error(data.message || data.error || 'Failed to send email via Resend API');
    }
    return data;
  }
}

async function sendOrderConfirmationEmail(prisma, order, language = 'ar') {
  try {
    const to = order.customerEmail;
    if (!to || !to.includes('@')) {
      console.log(`Skipping order confirmation email: Invalid email "${to}"`);
      return false;
    }

    const apiKey = process.env.RESEND_API_KEY || (await getSetting(prisma, 'resend_api_key', ''));
    const fromEmail = await getSetting(prisma, 'from_email', 'orders@the-vitahub.com');
    const fromName = await getSetting(prisma, 'from_name', 'The VitaHub');
    const whatsappNumber = await getSetting(prisma, 'whatsapp_number', '01201450111');
    const receivingNumber = await getSetting(prisma, 'receiving_number', '01009596452');
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://the-vitahub.com';

    const isEn = language === 'en';
    const currencyText = isEn ? 'EGP' : 'ج.م';

    const itemsHtml = order.items.map(item => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #edf2f7; font-weight: bold; color: #2d3748; text-align: ${isEn ? 'left' : 'right'};">
          ${item.title}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #edf2f7; text-align: center; color: #4a5568;">
          ${item.quantity}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #edf2f7; text-align: ${isEn ? 'right' : 'left'}; font-weight: bold; color: #10b981;">
          ${item.price} ${currencyText}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #edf2f7; text-align: ${isEn ? 'right' : 'left'}; font-weight: bold; color: #10b981;">
          ${item.price * item.quantity} ${currencyText}
        </td>
      </tr>
    `).join('');

    let paymentInstructions = '';
    if (order.paymentMethod === 'instapay' || order.paymentMethod === 'wallet') {
      const waLink = `https://wa.me/20${whatsappNumber.replace(/^0/, '')}?text=${encodeURIComponent(
        isEn
          ? `Transferred amount of ${order.total} EGP for order #${order.orderNumber} by: ${order.customerName}`
          : `تم تحويل مبلغ ${order.total} ج.م لطلب جديد رقم #${order.orderNumber} باسم: ${order.customerName}`
      )}`;
      paymentInstructions = isEn ? `
        <div style="margin-top: 24px; padding: 20px; background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px; text-align: left; direction: ltr;">
          <h4 style="margin: 0 0 10px 0; color: #b45309; font-size: 16px;">Payment and Receipt Instructions</h4>
          <p style="margin: 0 0 12px 0; color: #d97706; font-size: 14px; line-height: 1.6;">
            Please transfer the amount of <strong>${order.total} EGP</strong> to the following number via <strong>InstaPay</strong> or any electronic wallet (Vodafone Cash, etc.):
          </p>
          <div style="background-color: #ffffff; padding: 12px; border: 1px solid #fde68a; border-radius: 8px; text-align: center; font-size: 18px; font-weight: bold; color: #78350f; letter-spacing: 1px; margin-bottom: 15px;">
            ${receivingNumber}
          </div>
          <p style="margin: 0 0 15px 0; color: #d97706; font-size: 13px; line-height: 1.5;">
            After transfer, please send a screenshot of the receipt via WhatsApp to activate and ship your order as soon as possible.
          </p>
          <div style="text-align: center;">
            <a href="${waLink}" target="_blank" style="display: inline-block; background-color: #25d366; color: #ffffff; padding: 12px 24px; border-radius: 8px; font-weight: bold; text-decoration: none; font-size: 14px; box-shadow: 0 4px 6px rgba(37, 211, 102, 0.15);">
              Send Receipt via WhatsApp
            </a>
          </div>
        </div>
      ` : `
        <div style="margin-top: 24px; padding: 20px; background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px; text-align: right; direction: rtl;">
          <h4 style="margin: 0 0 10px 0; color: #b45309; font-size: 16px;">تعليمات الدفع وإرسال الإيصال</h4>
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
              إرسال الإيصال عبر الواتساب
            </a>
          </div>
        </div>
      `;
    }

    const emailSubject = isEn 
      ? `Order Confirmation - The VitaHub (#${order.orderNumber})`
      : `تأكيد طلبك من The VitaHub (#${order.orderNumber})`;

    const emailSubText = isEn
      ? '100% Original Vitamins & Dietary Supplements'
      : 'مكملات غذائية وفيتامينات أصلية 100%';

    const greetingText = isEn
      ? `Hello ${order.customerName},`
      : `مرحباً ${order.customerName}،`;

    const introText = isEn
      ? 'Your order has been placed successfully and is being prepared for shipping. Here are your invoice details:'
      : 'تم استلام طلبك بنجاح وجاري العمل على تجهيزه وشحنه إليك في أقرب وقت. إليك تفاصيل فاتورة طلبك:';

    const orderNumberLabel = isEn ? 'Order Number:' : 'رقم الطلب:';
    const orderDateLabel = isEn ? 'Order Date:' : 'تاريخ الطلب:';
    const addressLabel = isEn ? 'Address:' : 'العنوان:';
    const phoneLabel = isEn ? 'Phone:' : 'الهاتف:';

    const orderDateFormatted = isEn
      ? new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date(order.createdAt).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

    const tableProductHeader = isEn ? 'Product' : 'المنتج';
    const tableQtyHeader = isEn ? 'Quantity' : 'الكمية';
    const tablePriceHeader = isEn ? 'Price' : 'السعر';
    const tableTotalHeader = isEn ? 'Total' : 'الإجمالي';

    const shippingLabel = isEn ? 'Shipping & Delivery:' : 'الشحن والتوصيل:';
    const freeText = isEn ? 'Free' : 'مجاني';
    const shippingFeeFormatted = order.shippingFee === 0 ? freeText : `${order.shippingFee} ${currencyText}`;

    const finalTotalLabel = isEn ? 'Final Total:' : 'الإجمالي النهائي:';

    const footerText1 = isEn
      ? `Thank you for shopping at <a href="${siteUrl}" style="color: #10b981; text-decoration: none; font-weight: bold;">The VitaHub</a>.`
      : `شكراً لتسوقك من <a href="${siteUrl}" style="color: #10b981; text-decoration: none; font-weight: bold;">The VitaHub</a>.`;

    const footerText2 = isEn
      ? `If you have any questions, you can contact us on WhatsApp at <a href="https://wa.me/20${whatsappNumber.replace(/^0/, '')}">+20${whatsappNumber.substring(1)}</a>`
      : `إذا كان لديك أي استفسار، يمكنك دائماً التواصل معنا عبر الواتساب على رقم <a href="https://wa.me/20${whatsappNumber.replace(/^0/, '')}">+20${whatsappNumber.substring(1)}</a>`;

    const htmlContent = `
      <!DOCTYPE html>
      <html dir="${isEn ? 'ltr' : 'rtl'}" lang="${language}">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f7fafc; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
          .header { background-color: #064e3b; color: #ffffff; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 800; }
          .header p { margin: 5px 0 0 0; font-size: 12px; opacity: 0.8; font-weight: bold; }
          .content { padding: 30px; text-align: ${isEn ? 'left' : 'right'}; direction: ${isEn ? 'ltr' : 'rtl'}; }
          .greeting { font-size: 18px; font-weight: bold; color: #1a202c; margin-bottom: 10px; }
          .message { font-size: 14px; color: #4a5568; line-height: 1.6; margin-bottom: 25px; }
          .details-card { background-color: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 25px; border: 1px solid #edf2f7; }
          .details-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; color: #4a5568; }
          .details-label { font-weight: bold; color: #718096; }
          .details-value { font-weight: bold; color: #2d3748; }
          .table-container { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
          .table-header { background-color: #f8fafc; color: #718096; font-size: 11px; text-transform: uppercase; font-weight: 800; }
          .table-header th { padding: 12px; text-align: ${isEn ? 'left' : 'right'}; border-bottom: 2px solid #edf2f7; }
          .summary-row { font-size: 14px; font-weight: bold; color: #2d3748; }
          .summary-label { padding: 12px; text-align: ${isEn ? 'left' : 'right'}; color: #718096; }
          .summary-value { padding: 12px; text-align: ${isEn ? 'right' : 'left'}; }
          .total-row { font-size: 18px; font-weight: 800; color: #064e3b; background-color: #f0fdf4; }
          .footer { background-color: #f8fafc; padding: 20px; text-align: center; font-size: 11px; color: #a0aec0; border-top: 1px solid #edf2f7; }
          .footer a { color: #10b981; text-decoration: none; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1><a href="${siteUrl}" style="color: #ffffff; text-decoration: none;">The VitaHub</a></h1>
            <p>${emailSubText}</p>
          </div>
          <div class="content">
            <div class="greeting">${greetingText}</div>
            <div class="message">
              ${introText}
            </div>

            <div class="details-card">
              <div class="details-row">
                <span class="details-label">${orderNumberLabel}</span>
                <span class="details-value">#${order.orderNumber}</span>
              </div>
              <div class="details-row">
                <span class="details-label">${orderDateLabel}</span>
                <span class="details-value">${orderDateFormatted}</span>
              </div>
              <div class="details-row">
                <span class="details-label">${addressLabel}</span>
                <span class="details-value">${order.governorate} - ${order.district} - ${order.address}</span>
              </div>
              <div class="details-row">
                <span class="details-label">${phoneLabel}</span>
                <span class="details-value">${order.customerPhone}</span>
              </div>
            </div>

            <table class="table-container">
              <thead>
                <tr class="table-header">
                  <th style="text-align: ${isEn ? 'left' : 'right'};">${tableProductHeader}</th>
                  <th style="text-align: center; width: 60px;">${tableQtyHeader}</th>
                  <th style="text-align: ${isEn ? 'right' : 'left'}; width: 100px;">${tablePriceHeader}</th>
                  <th style="text-align: ${isEn ? 'right' : 'left'}; width: 100px;">${tableTotalHeader}</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
                <tr class="summary-row">
                  <td colspan="2" class="summary-label">${shippingLabel}</td>
                  <td colspan="2" style="padding: 12px; text-align: ${isEn ? 'right' : 'left'}; color: #10b981;">
                    ${shippingFeeFormatted}
                  </td>
                </tr>
                <tr class="total-row">
                  <td colspan="2" style="padding: 15px; text-align: ${isEn ? 'left' : 'right'};">${finalTotalLabel}</td>
                  <td colspan="2" style="padding: 15px; text-align: ${isEn ? 'right' : 'left'};">
                    ${order.total} ${currencyText}
                  </td>
                </tr>
              </tbody>
            </table>

            ${paymentInstructions}
          </div>
          <div class="footer">
            <p>${footerText1}</p>
            <p>${footerText2}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await sendViaResend({
      apiKey,
      fromEmail,
      fromName,
      to,
      subject: emailSubject,
      html: htmlContent
    });
    console.log(`Order confirmation email (${language}) sent successfully via Resend to ${to}`);
    return true;
  } catch (err) {
    console.error('Error sending order confirmation email via Resend:', err);
    return false;
  }
}

async function sendAdminOrderNotificationEmail(prisma, order) {
  try {
    const adminEmail = await getSetting(prisma, 'admin_notification_email', process.env.ADMIN_NOTIFICATION_EMAIL || 'the.vitaminshub@gmail.com');
    if (!adminEmail || !adminEmail.includes('@')) {
      console.log('Skipping admin order notification email: Invalid admin email');
      return false;
    }

    const apiKey = process.env.RESEND_API_KEY || (await getSetting(prisma, 'resend_api_key', ''));
    if (!apiKey) {
      console.warn('Skipping admin order notification email: RESEND_API_KEY is not configured');
      return false;
    }

    const fromEmail = await getSetting(prisma, 'from_email', 'orders@the-vitahub.com');
    const fromName = await getSetting(prisma, 'from_name', 'The VitaHub Orders');
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://the-vitahub.com').replace(/\/+$/, '');

    const orderDateFormatted = new Date(order.createdAt || Date.now()).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const paymentMethodMap = {
      cash: 'الدفع عند الاستلام (COD)',
      instapay: 'إنستاباي (InstaPay)',
      wallet: 'محفظة إلكترونية (فودافون كاش / أورنج / اتصالات)',
      card: 'بطاقة بنكية'
    };
    const paymentMethodText = paymentMethodMap[order.paymentMethod] || order.paymentMethod || 'الدفع عند الاستلام';

    const itemsHtml = (order.items || []).map(item => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #edf2f7; font-weight: bold; color: #2d3748; text-align: right;">
          ${item.title}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #edf2f7; text-align: center; color: #4a5568;">
          ${item.quantity}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #edf2f7; text-align: left; font-weight: bold; color: #10b981;">
          ${item.price} ج.م
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #edf2f7; text-align: left; font-weight: bold; color: #10b981;">
          ${item.price * item.quantity} ج.م
        </td>
      </tr>
    `).join('');

    const customerEmailDisplay = order.customerEmail && order.customerEmail.includes('@')
      ? `<a href="mailto:${order.customerEmail}" style="color: #10b981; text-decoration: none;">${order.customerEmail}</a>`
      : '<span style="color: #a0aec0; font-style: italic;">غير مسجل بإيميل (مسجل برقم الهاتف)</span>';

    const customerPhoneClean = String(order.customerPhone || '').replace(/\D/g, '');
    const waLink = customerPhoneClean ? `https://wa.me/${customerPhoneClean.startsWith('2') ? customerPhoneClean : '2' + customerPhoneClean}` : '';

    const addressParts = [
      order.governorate,
      order.district,
      order.address,
      order.building ? `عمارة: ${order.building}` : '',
      order.floor ? `دور: ${order.floor}` : '',
      order.apartment ? `شقة: ${order.apartment}` : ''
    ].filter(Boolean).join(' - ');

    const notesHtml = order.notes ? `
      <div style="margin-top: 15px; padding: 12px; background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; font-size: 13px; color: #92400e; text-align: right;">
        <strong>ملاحظات العميل:</strong> ${order.notes}
      </div>
    ` : '';

    const htmlContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f7fafc; margin: 0; padding: 0; }
          .container { max-width: 650px; margin: 25px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
          .header { background-color: #064e3b; color: #ffffff; padding: 25px 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 22px; font-weight: 800; }
          .header p { margin: 6px 0 0 0; font-size: 13px; opacity: 0.9; }
          .badge { display: inline-block; background-color: #10b981; color: #ffffff; padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-top: 10px; }
          .content { padding: 25px 30px; text-align: right; direction: rtl; }
          .card { background-color: #f8fafc; border-radius: 12px; padding: 18px 20px; margin-bottom: 20px; border: 1px solid #edf2f7; }
          .card-title { font-size: 14px; font-weight: bold; color: #064e3b; margin-bottom: 12px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
          .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; color: #4a5568; }
          .label { font-weight: bold; color: #718096; min-width: 110px; }
          .value { font-weight: bold; color: #1a202c; text-align: left; }
          .table-container { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          .table-header { background-color: #f8fafc; color: #718096; font-size: 11px; text-transform: uppercase; font-weight: 800; }
          .table-header th { padding: 10px 12px; text-align: right; border-bottom: 2px solid #edf2f7; }
          .total-row { font-size: 16px; font-weight: 800; color: #064e3b; background-color: #f0fdf4; }
          .btn-container { text-align: center; margin: 25px 0 10px 0; }
          .btn { display: inline-block; background-color: #064e3b; color: #ffffff; padding: 12px 28px; border-radius: 8px; font-weight: bold; text-decoration: none; font-size: 13px; }
          .footer { background-color: #f8fafc; padding: 16px; text-align: center; font-size: 11px; color: #a0aec0; border-top: 1px solid #edf2f7; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>إشعار طلب جديد #${order.orderNumber}</h1>
            <p>تم تسجيل طلب جديد على متجر The VitaHub</p>
            <span class="badge">الإجمالي: ${order.total} ج.م</span>
          </div>
          <div class="content">
            <div class="card">
              <div class="card-title">بيانات العميل</div>
              <div class="row"><span class="label">اسم العميل:</span><span class="value">${order.customerName}</span></div>
              <div class="row">
                <span class="label">رقم الهاتف:</span>
                <span class="value">
                  <a href="tel:${order.customerPhone}" style="color: #10b981; text-decoration: none;">${order.customerPhone}</a>
                  ${waLink ? `&nbsp;|&nbsp;<a href="${waLink}" target="_blank" style="color: #25d366; text-decoration: none;">مراسلة واتساب</a>` : ''}
                </span>
              </div>
              <div class="row"><span class="label">البريد الإلكتروني:</span><span class="value">${customerEmailDisplay}</span></div>
              <div class="row"><span class="label">عنوان التوصيل:</span><span class="value">${addressParts}</span></div>
              <div class="row"><span class="label">تاريخ الطلب:</span><span class="value">${orderDateFormatted}</span></div>
              <div class="row"><span class="label">طريقة الدفع:</span><span class="value">${paymentMethodText}</span></div>
              ${notesHtml}
            </div>

            <div class="card">
              <div class="card-title">المنتجات المطلوبة</div>
              <table class="table-container">
                <thead>
                  <tr class="table-header">
                    <th>المنتج</th>
                    <th style="text-align: center; width: 60px;">الكمية</th>
                    <th style="text-align: left; width: 90px;">السعر</th>
                    <th style="text-align: left; width: 100px;">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                  <tr>
                    <td colspan="2" style="padding: 10px 12px; color: #718096; font-weight: bold;">الشحن والتوصيل:</td>
                    <td colspan="2" style="padding: 10px 12px; text-align: left; color: #10b981; font-weight: bold;">
                      ${order.shippingFee === 0 ? 'مجاني' : `${order.shippingFee} ج.م`}
                    </td>
                  </tr>
                  <tr class="total-row">
                    <td colspan="2" style="padding: 12px; font-weight: 800;">الإجمالي النهائي:</td>
                    <td colspan="2" style="padding: 12px; text-align: left; font-weight: 800; color: #064e3b;">
                      ${order.total} ج.م
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="btn-container">
              <a href="${siteUrl}/admin" class="btn" target="_blank">معاينة وإدارة الطلب في لوحة التحكم</a>
            </div>
          </div>
          <div class="footer">
            نظام إدارة متجر The VitaHub التلقائي • مرسل إلى ${adminEmail}
          </div>
        </div>
      </body>
      </html>
    `;

    const emailSubject = `طلب جديد #${order.orderNumber} - ${order.customerName} (${order.total} ج.م)`;

    await sendViaResend({
      apiKey,
      fromEmail,
      fromName,
      to: adminEmail,
      subject: emailSubject,
      html: htmlContent
    });
    console.log(`Admin order notification email sent successfully via Resend to ${adminEmail}`);
    return true;
  } catch (err) {
    console.error('Error sending admin order notification email via Resend:', err);
    return false;
  }
}

async function sendTestEmail(settings, toEmail) {
  const apiKey = settings.resend_api_key || process.env.RESEND_API_KEY || '';
  const fromEmail = settings.from_email || 'orders@the-vitahub.com';
  const fromName = settings.from_name || 'The VitaHub';

  if (!apiKey) {
    throw new Error('مفتاح API الخاص بـ Resend غير مدخل.');
  }

  const subject = 'رسالة تجريبية من لوحة تحكم The VitaHub عبر منصة Resend';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; text-align: right; direction: rtl;">
      <h2 style="color: #10b981; text-align: center;">اتصال Resend ناجح</h2>
      <p style="font-size: 14px; color: #4a5568; line-height: 1.6;">
        مرحباً، هذه رسالة تجريبية تم إرسالها من متجر <strong>The VitaHub</strong> عبر منصة <strong>Resend</strong> الرسمية للتأكد من نجاح ربط مفتاح الـ API وصلاحية الإرسال.
      </p>
      <hr style="border: 0; border-top: 1px solid #edf2f7; margin: 20px 0;" />
      <div style="font-size: 12px; color: #a0aec0; text-align: center;" dir="ltr">
        Sender: ${fromName} &lt;${fromEmail}&gt; • Provider: Resend Cloud
      </div>
    </div>
  `;

  return await sendViaResend({
    apiKey,
    fromEmail,
    fromName,
    to: toEmail,
    subject,
    html
  });
}

module.exports = {
  sendOrderConfirmationEmail,
  sendAdminOrderNotificationEmail,
  sendTestEmail
};
