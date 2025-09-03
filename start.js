#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('Starting Quest BSR Discord Bot...');

const botProcess = spawn('node', ['bot.js'], {
  stdio: 'inherit',
  cwd: __dirname
});

botProcess.on('close', (code) => {
  console.log(`Bot process exited with code ${code}`);
});

botProcess.on('error', (err) => {
  console.error('Failed to start bot:', err);
});