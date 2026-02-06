/**
 * Stealth scripts injected into every page to evade bot detection.
 * These run before any site JavaScript executes.
 */
export const STEALTH_SCRIPTS = [
  // 1. Hide webdriver flag
  `Object.defineProperty(navigator, 'webdriver', { get: () => false });`,

  // 2. Fake plugins array (Chrome normally has PDF + Chrome PDF Viewer)
  `Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      plugins.length = 3;
      return plugins;
    }
  });`,

  // 3. Fake languages (match Accept-Language header)
  `Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'nl'] });`,

  // 4. Fake platform
  `Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });`,

  // 5. Fake hardware concurrency (real machines have 4-16 cores)
  `Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });`,

  // 6. Fake device memory
  `Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });`,

  // 7. Chrome runtime stub (sites check for window.chrome)
  `window.chrome = {
    runtime: {
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: () => {},
      connect: () => ({ onMessage: { addListener: () => {} }, postMessage: () => {} }),
    },
    loadTimes: () => ({}),
    csi: () => ({}),
  };`,

  // 8. Permissions API — make it look normal
  `const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
   if (originalQuery) {
     window.navigator.permissions.query = (params) => {
       if (params.name === 'notifications') {
         return Promise.resolve({ state: Notification.permission });
       }
       return originalQuery(params);
     };
   }`,

  // 9. WebGL vendor/renderer (real Chrome on Windows values)
  `const getParameter = WebGLRenderingContext.prototype.getParameter;
   WebGLRenderingContext.prototype.getParameter = function(param) {
     if (param === 37445) return 'Google Inc. (NVIDIA)';
     if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
     return getParameter.call(this, param);
   };`,

  // 10. Prevent iframe detection (some sites embed detection iframes)
  `Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    get: function() {
      return window;
    }
  });`,

  // 11. Canvas fingerprint consistency - add realistic noise
  `const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
   const originalToBlob = HTMLCanvasElement.prototype.toBlob;
   const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
   
   // Consistent noise generator based on session
   const canvasNoise = function(context, width, height) {
     const imageData = context.getImageData(0, 0, width, height);
     const data = imageData.data;
     // Add minimal, consistent noise to avoid detection
     for (let i = 0; i < data.length; i += 4) {
       const noise = (Math.sin(i) * 127 + 128) % 2;
       data[i] = data[i] + noise;
       data[i + 1] = data[i + 1] + noise;
       data[i + 2] = data[i + 2] + noise;
     }
     return imageData;
   };
   
   HTMLCanvasElement.prototype.toDataURL = function() {
     if (this.width && this.height) {
       const context = this.getContext('2d');
       if (context) {
         const imageData = canvasNoise(context, this.width, this.height);
         context.putImageData(imageData, 0, 0);
       }
     }
     return originalToDataURL.apply(this, arguments);
   };
   
   HTMLCanvasElement.prototype.toBlob = function() {
     if (this.width && this.height) {
       const context = this.getContext('2d');
       if (context) {
         const imageData = canvasNoise(context, this.width, this.height);
         context.putImageData(imageData, 0, 0);
       }
     }
     return originalToBlob.apply(this, arguments);
   };
   
   CanvasRenderingContext2D.prototype.getImageData = function() {
     const imageData = originalGetImageData.apply(this, arguments);
     // Add minimal noise
     for (let i = 0; i < imageData.data.length; i += 4) {
       const noise = (Math.sin(i) * 127 + 128) % 2;
       imageData.data[i] = imageData.data[i] + noise;
     }
     return imageData;
   };`,

  // 12. AudioContext fingerprint - spoof to look like real device
  `const AudioContext = window.AudioContext || window.webkitAudioContext;
   if (AudioContext) {
     const originalCreateAnalyser = AudioContext.prototype.createAnalyser;
     const originalCreateOscillator = AudioContext.prototype.createOscillator;
     
     // Add realistic noise to audio fingerprint
     AudioContext.prototype.createAnalyser = function() {
       const analyser = originalCreateAnalyser.apply(this, arguments);
       const originalGetFloatFrequencyData = analyser.getFloatFrequencyData;
       analyser.getFloatFrequencyData = function(array) {
         originalGetFloatFrequencyData.apply(this, arguments);
         // Add minimal noise
         for (let i = 0; i < array.length; i++) {
           array[i] = array[i] + Math.random() * 0.0001;
         }
         return array;
       };
       return analyser;
     };
     
     AudioContext.prototype.createOscillator = function() {
       const oscillator = originalCreateOscillator.apply(this, arguments);
       const originalStart = oscillator.start;
       oscillator.start = function() {
         // Add tiny frequency variation
         oscillator.frequency.value = oscillator.frequency.value + Math.random() * 0.001;
         return originalStart.apply(this, arguments);
       };
       return oscillator;
     };
   }`,

  // 13. Battery API - return realistic values
  `if (navigator.getBattery) {
     const originalGetBattery = navigator.getBattery.bind(navigator);
     navigator.getBattery = async function() {
       const battery = await originalGetBattery();
       Object.defineProperty(battery, 'charging', { get: () => true });
       Object.defineProperty(battery, 'chargingTime', { get: () => 0 });
       Object.defineProperty(battery, 'dischargingTime', { get: () => Infinity });
       Object.defineProperty(battery, 'level', { get: () => 0.85 + Math.random() * 0.14 });
       return battery;
     };
   }`,

  // 14. Media devices - spoof realistic devices
  `if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
     const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
     navigator.mediaDevices.enumerateDevices = async function() {
       const devices = await originalEnumerateDevices();
       // Add fake but realistic devices
       return [
         { deviceId: "default", groupId: "group1", kind: "audioinput", label: "Default - Microphone (Realtek)" },
         { deviceId: "communications", groupId: "group1", kind: "audioinput", label: "Communications - Microphone (Realtek)" },
         { deviceId: "default", groupId: "group2", kind: "audiooutput", label: "Default - Speaker (Realtek)" },
         { deviceId: "default", groupId: "group3", kind: "videoinput", label: "HD WebCam (04f2:b69e)" },
       ];
     };
   }`,

  // 15. Connection API - spoof realistic network
  `if (navigator.connection || navigator.mozConnection || navigator.webkitConnection) {
     const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
     Object.defineProperty(connection, 'effectiveType', { get: () => '4g' });
     Object.defineProperty(connection, 'downlink', { get: () => 10 + Math.random() * 5 });
     Object.defineProperty(connection, 'rtt', { get: () => 50 + Math.random() * 50 });
     Object.defineProperty(connection, 'saveData', { get: () => false });
   }`,
];
