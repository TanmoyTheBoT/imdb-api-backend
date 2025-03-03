require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mysql = require("mysql2/promise");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("The FMDb API Server - Status: Running");
});

// Create HTTP server and attach Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN, // Adjust for production: set your frontend domain
    methods: ["GET", "POST"]
  }
});

// Create a MySQL connection pool using your Aiven MySQL credentials
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: process.env.MYSQL_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ✅ Check database connection when the server starts
pool.getConnection()
  .then(conn => {
    console.log("✅ Connected to MySQL database");
    conn.release();
  })
  .catch(err => {
    console.error("❌ MySQL connection error:", err);
  });

// Configure Nodemailer with Gmail SMTP (using an App Password)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,   // your Gmail address
    pass: process.env.EMAIL_PASS    // your Gmail App Password
  }
});

io.on("connection", async (socket) => {
  // Use x-forwarded-for if available; otherwise fallback to socket.handshake.address
  let clientIp = socket.handshake.headers["x-forwarded-for"] 
    ? socket.handshake.headers["x-forwarded-for"].split(",")[0].trim() 
    : socket.handshake.address;

  try {
    // Fetch location data from ip-api.com using the cleaned IP
    const { data } = await axios.get(`http://ip-api.com/json/${clientIp}`);

    if (data.status === "success") {
      console.log(
        `Client connected: ${socket.id}, IP: ${clientIp}, Location: ${data.city}, ${data.country}, ISP: ${data.isp}`
      );
      socket.emit("locationInfo", {
        ip: clientIp,
        city: data.city,
        region: data.regionName,
        country: data.country,
        isp: data.isp
      });
    } else {
      console.log(
        `Client connected: ${socket.id}, IP: ${clientIp}, Location: unavailable (API response: ${data.message})`
      );
    }
  } catch (error) {
    console.error("Error fetching location:", error);
  }

  // Listen for "register" event from client
  socket.on("register", async (data) => {
    const { firstName, lastName, email, use_case } = data;
    
    // Basic validation
    if (!firstName || !lastName || !email || !use_case) {
      socket.emit("registrationResponse", { 
        status: "error", 
        message: "All fields are required." 
      });
      return;
    }

    try {
      // Check if email already exists
      const [rows] = await pool.execute(
        "SELECT api_key FROM users WHERE email = ?", [email]
      );

      if (rows.length > 0) {
        socket.emit("registrationResponse", { 
          status: "error", 
          message: "Email already registered. Please check your email for your API key." 
        });
        return;
      }

      // Generate a secure API key
      const apiKey = crypto.randomBytes(16).toString("hex");

      // Insert the new user into the database
      await pool.execute(
        "INSERT INTO users (first_name, last_name, email, api_key, use_case) VALUES (?, ?, ?, ?, ?)",
        [firstName, lastName, email, apiKey, use_case]
      );

      // Send the API key via email
      await transporter.sendMail({
        from: `The FMDb API <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Your FMDb API Key",
        text: `Hello ${firstName},\n\nYour API key is: ${apiKey}\n\nBest regards,\nThe FMDb Team`,
      });      

      // Emit success response back to the client
      socket.emit("registrationResponse", {
        status: "success",
        message: "API key generated and sent to your email!"
      });
    } catch (error) {
      console.error("Registration error:", error);
      socket.emit("registrationResponse", {
        status: "error",
        message: "Server error. Please try again later."
      });
    }
  });

  // Log client disconnect
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}, IP: ${clientIp}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Socket.io server running on port ${PORT}`);
});
