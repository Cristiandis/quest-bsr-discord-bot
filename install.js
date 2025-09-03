#!/usr/bin/env node

const { spawn } = require('child_process');

console.log('Installing dependencies...');

const installProcess = spawn('npm', ['install'], {
  stdio: 'inherit',
  shell: true
});

installProcess.on('close', (code) => {
  if (code === 0) {
    console.log('Dependencies installed successfully!');
    console.log('You can now run "npm start" or "node start.js" to start the bot.');
  } else {
    console.log(`Installation failed with code ${code}`);
  }
});

installProcess.on('error', (err) => {
  console.error('Failed to install dependencies:', err);
});
