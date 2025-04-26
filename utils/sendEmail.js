const nodemailer = require("nodemailer");

exports.sendMagicLink = async (to, link) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USERNAME,
      to,
      subject: "Your Login Link",
      html: `
        <h3>Welcome to Authera!</h3>
        <p>Click the link below to log in. This link will expire in 5 minutes.</p>
        <a href="${link}">${link}</a>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Magic link sent to ${to}`);
  } catch (err) {
    console.error("Error sending email:", err);
    throw err;
  }
};
