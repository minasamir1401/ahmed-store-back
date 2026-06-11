const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const prisma = new PrismaClient();

async function createAdmin() {
  const email = process.argv[2] || 'admin@mithaly.com';
  const password = process.argv[3] || 'admin123456';
  const name = process.argv[4] || 'المدير العام';
  const phone = process.argv[5] || '201000000000'; // Default phone number format

  console.log(`Creating/Updating Admin user: ${email}...`);

  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    
    const adminUser = await prisma.user.upsert({
      where: { email: email.toLowerCase().trim() },
      update: {
        password: hashedPassword,
        name: name.trim(),
        phone: phone.trim(),
        role: 'admin'
      },
      create: {
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        name: name.trim(),
        phone: phone.trim(),
        role: 'admin'
      }
    });

    console.log(`✅ Admin user created/updated successfully!`);
    console.log(`Email: ${adminUser.email}`);
    console.log(`Role: ${adminUser.role}`);
    console.log(`Name: ${adminUser.name}`);
    console.log(`You can now log in via the admin panel.`);
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
