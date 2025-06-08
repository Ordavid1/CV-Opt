// Find this section around line 31:
// Read SSL certificates
const options = {
  key: fs.readFileSync(path.join(__dirname, 'certificates', 'localhost-key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'certificates', 'localhost.pem'))
};

// Replace it with:
let server;
let protocolUsed = 'http';

try {
  if (process.env.NODE_ENV === 'production') {
    console.log('Starting in PRODUCTION mode with HTTP');
    server = http.createServer(app);
  } else {
    try {
      const options = {
        key: fs.readFileSync(path.join(__dirname, 'certificates', 'localhost-key.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'certificates', 'localhost.pem'))
      };
      console.log('Starting in DEVELOPMENT mode with HTTPS');
      server = https.createServer(options, app);
      protocolUsed = 'https';
    } catch (certError) {
      console.error('Failed to load SSL certificates:', certError.message);
      console.log('Falling back to HTTP for development');
      server = http.createServer(app);
    }
  }
} catch (error) {
  console.error('Error creating server:', error);
  server = http.createServer(app);
}
