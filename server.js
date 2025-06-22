const mqtt = require('mqtt');
const admin = require('firebase-admin');
require('dotenv').config()

// ===== CONFIGURATION =====
const MQTT_CONFIG = {
  broker: process.env.BROKER_URL,
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  clientId: `${process.env.MQTT_CLIENTID}_${Date.now()}`
};

const TOPICS = {
  // ESP32 topics
  sensorData: 'greenhouse/sensors/data',
  pumpControl: 'greenhouse/control/pump',
  pumpStatus: 'greenhouse/pump/status',
  
  // Flutter app topics (bidirectional communication)
  appSensorData: 'greenhouse/app/sensors/data',
  appPumpControl: 'greenhouse/app/control/pump',
  appPumpStatus: 'greenhouse/app/pump/status',
  
  // General topics
  sensorsSoil: 'greenhouse/sensors/soil',
  sensorsWildcard: 'greenhouse/sensors/+',
  statusWildcard: 'greenhouse/status/+',
  appWildcard: 'greenhouse/app/+',
  
  // Environment data from mobile app
  environmentData: 'greenhouse/environment/data',
  
  // Bi-directional sync topics
  syncSensors: 'greenhouse/sync/sensors',
  syncPump: 'greenhouse/sync/pump'
};

// ===== FIREBASE SETUP =====
// Initialize Firebase Admin SDK
const serviceAccount = require('./firebase-service-account-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.DATABASE_URL
});

const db = admin.database();

// ===== MQTT CLIENT SETUP =====
let mqttClient = null;
let isConnected = false;

function connectMQTT() {
  console.log('🔄 Connecting to MQTT broker...');
  
  mqttClient = mqtt.connect(MQTT_CONFIG.broker, {
    clientId: MQTT_CONFIG.clientId,
    username: MQTT_CONFIG.username,
    password: MQTT_CONFIG.password,
    clean: true,
    keepalive: 30,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
    rejectUnauthorized: false
  });

  mqttClient.on('connect', () => {
    console.log('✅ Connected to MQTT broker');
    isConnected = true;
    
    // Subscribe to all relevant topics
    const topicsToSubscribe = [
      // ESP32 topics
      TOPICS.sensorData,
      TOPICS.pumpStatus,
      TOPICS.pumpControl,
      TOPICS.sensorsSoil,
      TOPICS.sensorsWildcard,
      TOPICS.statusWildcard,
      
      // Flutter app topics
      TOPICS.appSensorData,
      TOPICS.appPumpControl,
      TOPICS.appPumpStatus,
      TOPICS.appWildcard,
      TOPICS.environmentData,
      
      // Sync topics
      TOPICS.syncSensors,
      TOPICS.syncPump
    ];
    
    topicsToSubscribe.forEach(topic => {
      mqttClient.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`❌ Error subscribing to ${topic}:`, err);
        } else {
          console.log(`✅ Subscribed to topic: ${topic}`);
        }
      });
    });

    // Publish bridge status
    publishBridgeStatus('online');
  });

  mqttClient.on('message', async (topic, message) => {
    try {
      const messageStr = message.toString();
      console.log(`📨 Received from ${topic}: ${messageStr}`);
      
      // Parse message
      let data;
      try {
        data = JSON.parse(messageStr);
        console.log('✅ JSON message parsed successfully');
      } catch (jsonError) {
        console.log('⚠️ Non-JSON message, creating structured data');
        data = {
          raw_message: messageStr,
          message_type: 'text',
          topic: topic,
          received_at: new Date().toISOString()
        };
        
        // Try to extract simple key-value pairs
        if (messageStr.includes('=') || messageStr.includes(':')) {
          data.parsed_attempt = parseSimpleFormat(messageStr);
        }
      }
      
      // Add metadata
      data.topic = topic;
      data.received_at = new Date().toISOString();
      data.server_timestamp = Date.now();
      
      // Route message to appropriate handler
      await routeMessage(topic, data);
      
    } catch (error) {
      console.error('❌ Error processing MQTT message:', error);
    }
  });

  mqttClient.on('error', (error) => {
    console.error('❌ MQTT Error:', error);
    isConnected = false;
  });

  mqttClient.on('disconnect', () => {
    console.log('🔌 MQTT Disconnected');
    isConnected = false;
  });

  mqttClient.on('reconnect', () => {
    console.log('🔄 MQTT Reconnecting...');
  });
}

// ===== MESSAGE ROUTING =====
async function routeMessage(topic, data) {
  try {
    console.log(`🚦 Routing message from topic: ${topic}`);
    
    // Handle ESP32 sensor data
    if (topic.includes('sensors') && !topic.includes('app')) {
      await handleESP32SensorData(data);
    }
    // Handle Flutter app sensor data
    else if (topic.includes('app') && topic.includes('sensors')) {
      await handleAppSensorData(data);
    }
    // Handle environment data from mobile app
    else if (topic === TOPICS.environmentData) {
      await handleEnvironmentData(data);
    }
    // Handle pump data from any source
    else if (topic.includes('pump')) {
      await handlePumpData(data, topic);
    }
    // Handle sync requests
    else if (topic.includes('sync')) {
      await handleSyncRequest(data, topic);
    }
    else {
      console.log(`ℹ️ Unhandled topic: ${topic}, saving to general messages`);
      await saveToFirebaseHistory('greenhouse_data/general_messages', data);
    }
  } catch (error) {
    console.error('❌ Error routing message:', error);
  }
}

// ===== ESP32 SENSOR DATA HANDLER =====
async function handleESP32SensorData(data) {
  try {
    console.log('🌱 Processing ESP32 sensor data...');
    
    // Extract sensor values from ESP32 format
    const sensor1Value = extractSensorValue(data, 'sensor_1');
    const sensor2Value = extractSensorValue(data, 'sensor_2');
    
    if (sensor1Value === null && sensor2Value === null) {
      console.log('⚠️ No valid sensor values found in ESP32 data');
      console.log('📋 Available data keys:', Object.keys(data));
      return;
    }
    
    console.log(`📊 ESP32 - Extracted values - Sensor1: ${sensor1Value ?? "N/A"}, Sensor2: ${sensor2Value ?? "N/A"}`);
    
    // Create Firebase-compatible sensor data structure
    const sensorData = {
      sensor: {
        soil_sensor_1: {
          value: sensor1Value || 0.0,
          sensor_id: 'sensor_1',
          is_active: sensor1Value !== null,
          condition: getSensorCondition(sensor1Value)
        },
        soil_sensor_2: {
          value: sensor2Value || 0.0,
          sensor_id: 'sensor_2', 
          is_active: sensor2Value !== null,
          condition: getSensorCondition(sensor2Value)
        }
      },
      timestamp: Date.now(),
      updated_at: new Date().toISOString(),
      source: 'esp32_device',
      data_type: 'sensor_reading'
    };
    
    // Calculate additional metrics
    const activeSensors = [sensor1Value, sensor2Value].filter(v => v !== null);
    if (activeSensors.length > 0) {
      const average = activeSensors.reduce((a, b) => a + b, 0) / activeSensors.length;
      sensorData.sensor.average_humidity = parseFloat(average.toFixed(1));
      sensorData.sensor.overall_condition = getSensorCondition(average);
    }
    
    // Save to Firebase current sensor data
    await saveToFirebase('greenhouse_data/current_sensor', sensorData);
    
    // Also save to history with ESP32 tag
    await saveToFirebaseHistory('greenhouse_data/sensor_history', {
      ...sensorData,
      device_source: 'esp32'
    });
    
    // Forward to app if needed
    await forwardToApp('sensors', sensorData);
    
    console.log('✅ ESP32 sensor data saved to Firebase');
    
  } catch (error) {
    console.error('❌ Error handling ESP32 sensor data:', error);
  }
}

// ===== FLUTTER APP SENSOR DATA HANDLER =====
async function handleAppSensorData(data) {
  try {
    console.log('📱 Processing Flutter app sensor data...');
    
    // Handle sensor data published by Flutter app (GreenhouseProvider)
    let sensorData;
    
    // Check if data is already in Firebase format
    if (data.sensors && typeof data.sensors === 'object') {
      console.log('📦 Data is in Flutter sensors format');
      
      // Extract values from Flutter format
      const sensor1 = data.sensors.sensor_1;
      const sensor2 = data.sensors.sensor_2;
      
      sensorData = {
        sensor: {
          soil_sensor_1: {
            value: sensor1?.value || 0.0,
            sensor_id: sensor1?.sensor_id || 'sensor_1',
            is_active: sensor1?.is_active || false,
            condition: getSensorCondition(sensor1?.value)
          },
          soil_sensor_2: {
            value: sensor2?.value || 0.0,
            sensor_id: sensor2?.sensor_id || 'sensor_2',
            is_active: sensor2?.is_active || false,
            condition: getSensorCondition(sensor2?.value)
          }
        },
        timestamp: Date.now(),
        updated_at: new Date().toISOString(),
        source: 'flutter_app',
        data_type: 'app_sensor_update'
      };
      
      // Calculate metrics
      const activeSensors = [];
      if (sensor1?.is_active && sensor1?.value > 0) activeSensors.push(sensor1.value);
      if (sensor2?.is_active && sensor2?.value > 0) activeSensors.push(sensor2.value);
      
      if (activeSensors.length > 0) {
        const average = activeSensors.reduce((a, b) => a + b, 0) / activeSensors.length;
        sensorData.sensor.average_humidity = parseFloat(average.toFixed(1));
        sensorData.sensor.overall_condition = getSensorCondition(average);
      }
      
      console.log(`📊 App - Sensor1: ${sensor1?.value}%, Sensor2: ${sensor2?.value}%`);
    }
    // Handle other app sensor formats
    else if (data.sensor_type || data.value !== undefined) {
      console.log('📊 Data is in single sensor format');
      
      sensorData = {
        sensor: {
          soil_sensor_1: {
            value: parseFloat(data.value) || 0.0,
            sensor_id: data.sensor_id || 'mobile_sensor',
            is_active: true,
            condition: getSensorCondition(data.value)
          }
        },
        timestamp: Date.now(),
        updated_at: new Date().toISOString(),
        source: 'flutter_app_single',
        data_type: 'single_sensor_update'
      };
    }
    else {
      console.log('⚠️ Unknown app sensor data format');
      return;
    }
    
    // Save to Firebase with app source
    await saveToFirebase('greenhouse_data/current_sensor_app', sensorData);
    
    // Also save to history with app tag
    await saveToFirebaseHistory('greenhouse_data/sensor_history', {
      ...sensorData,
      device_source: 'flutter_app'
    });
    
    // Forward to ESP32 if needed (sync)
    await forwardToESP32('sensors', sensorData);
    
    console.log('✅ Flutter app sensor data saved to Firebase');
    
  } catch (error) {
    console.error('❌ Error handling Flutter app sensor data:', error);
  }
}

// ===== ENVIRONMENT DATA HANDLER =====
async function handleEnvironmentData(data) {
  try {
    console.log('🌡️ Processing environment data from mobile app...');
    
    const envData = {
      environment: {
        temperature: data.temperature || null,
        humidity: data.humidity || null,
        soil_moisture: data.soil_moisture || null,
        light_level: data.light_level || null
      },
      timestamp: Date.now(),
      updated_at: new Date().toISOString(),
      source: 'mobile_app',
      data_type: 'environment_reading'
    };
    
    // Save to Firebase
    await saveToFirebase('greenhouse_data/current_environment', envData);
    await saveToFirebaseHistory('greenhouse_data/environment_history', envData);
    
    console.log('✅ Environment data saved to Firebase');
    
  } catch (error) {
    console.error('❌ Error handling environment data:', error);
  }
}

// ===== PUMP DATA HANDLER =====
async function handlePumpData(data, topic) {
  try {
    console.log('🔧 Processing pump data...');
    console.log(`🔧 Topic: ${topic}, Data:`, data);
    
    // Extract pump status
    let isActive = extractPumpStatus(data);
    
    // If this is a control command, convert to status
    if (data.action && isActive === null) {
      const action = data.action.toString().toLowerCase();
      isActive = action === 'on' || action === 'start' || action === 'activate';
      console.log(`🔄 Converted control command '${action}' to status: ${isActive}`);
    }
    
    // Handle Flutter app control format
    if (data.command && isActive === null) {
      const command = data.command.toString().toLowerCase();
      isActive = command === 'start' || command === 'on' || command === 'activate';
      console.log(`🔄 Converted Flutter command '${command}' to status: ${isActive}`);
    }
    
    if (isActive === null) {
      console.log('⚠️ No valid pump status found');
      console.log('📋 Available keys:', Object.keys(data));
      return;
    }
    
    console.log(`🔧 Extracted pump status: ${isActive ? "ON" : "OFF"}`);
    
    // Determine source
    let source = 'unknown';
    if (topic.includes('app')) source = 'flutter_app';
    else if (data.source) source = data.source;
    else source = 'esp32_device';
    
    // Create Firebase-compatible pump data structure
    const pumpData = {
      pump: {
        water_pump: {
          is_active: isActive,
          status: isActive ? 'on' : 'off',
          last_changed: new Date().toISOString()
        }
      },
      timestamp: Date.now(),
      updated_at: new Date().toISOString(),
      source: source,
      data_type: 'pump_status_update',
      command_id: data.command_id || null
    };
    
    // Save to Firebase current pump data
    await saveToFirebase('greenhouse_data/current_pump', pumpData);
    
    // Also save to history
    await saveToFirebaseHistory('greenhouse_data/pump_history', {
      ...pumpData,
      device_source: source
    });
    
    // Forward pump commands appropriately
    if (topic.includes('app') && topic.includes('control')) {
      // App is controlling pump, forward to ESP32
      await forwardPumpCommandToESP32(isActive, data);
    } else if (topic.includes('control') && !topic.includes('app')) {
      // ESP32 control, forward status to app
      await forwardPumpStatusToApp(isActive, data);
    }
    
    console.log('✅ Pump data saved to Firebase');
    
  } catch (error) {
    console.error('❌ Error handling pump data:', error);
  }
}

// ===== SYNC REQUEST HANDLER =====
async function handleSyncRequest(data, topic) {
  try {
    console.log('🔄 Processing sync request...');
    
    if (topic === TOPICS.syncSensors) {
      // Send latest sensor data to requester
      const latestSensor = await getLatestFromFirebase('greenhouse_data/current_sensor');
      if (latestSensor) {
        await publishToTopic(TOPICS.sensorData, latestSensor);
      }
    } else if (topic === TOPICS.syncPump) {
      // Send latest pump data to requester
      const latestPump = await getLatestFromFirebase('greenhouse_data/current_pump');
      if (latestPump) {
        await publishToTopic(TOPICS.pumpStatus, latestPump);
      }
    }
    
    console.log('✅ Sync request handled');
    
  } catch (error) {
    console.error('❌ Error handling sync request:', error);
  }
}

// ===== FORWARDING FUNCTIONS =====
async function forwardToApp(dataType, data) {
  try {
    if (dataType === 'sensors') {
      await publishToTopic(TOPICS.appSensorData, data);
      console.log('📱 Forwarded sensor data to app');
    }
  } catch (error) {
    console.error('❌ Error forwarding to app:', error);
  }
}

async function forwardToESP32(dataType, data) {
  try {
    if (dataType === 'sensors') {
      await publishToTopic(TOPICS.sensorData, data);
      console.log('📡 Forwarded sensor data to ESP32');
    }
  } catch (error) {
    console.error('❌ Error forwarding to ESP32:', error);
  }
}

async function forwardPumpCommandToESP32(isActive, originalData) {
  try {
    const command = {
      device: 'water_pump',
      action: isActive ? 'on' : 'off',
      timestamp: new Date().toISOString(),
      source: 'bridge_forward',
      command_id: originalData.command_id || Date.now().toString(),
      original_source: originalData.source || 'unknown'
    };
    
    await publishToTopic(TOPICS.pumpControl, command);
    console.log('📡 Forwarded pump command to ESP32:', command);
  } catch (error) {
    console.error('❌ Error forwarding pump command to ESP32:', error);
  }
}

async function forwardPumpStatusToApp(isActive, originalData) {
  try {
    const status = {
      device: 'water_pump',
      is_active: isActive,
      status: isActive ? 'on' : 'off',
      timestamp: new Date().toISOString(),
      source: 'bridge_forward',
      command_id: originalData.command_id || null,
      original_source: originalData.source || 'esp32'
    };
    
    await publishToTopic(TOPICS.appPumpStatus, status);
    console.log('📱 Forwarded pump status to app:', status);
  } catch (error) {
    console.error('❌ Error forwarding pump status to app:', error);
  }
}

// ===== FIREBASE HELPERS =====
async function saveToFirebase(path, data) {
  try {
    await db.ref(path).set(data);
    console.log(`💾 Data saved to Firebase: ${path}`);
  } catch (error) {
    console.error(`❌ Error saving to Firebase ${path}:`, error);
  }
}

async function saveToFirebaseHistory(path, data) {
  try {
    const now = new Date();
    const historyEntry = {
      ...data,
      id: `${Date.now()}_${now.getMilliseconds()}`,
      recorded_at: now.toISOString(),
      date_key: getDateKey(now),
      hour: now.getHours(),
      minute: now.getMinutes()
    };
    
    await db.ref(path).push(historyEntry);
    console.log(`📚 History data saved to Firebase: ${path}`);
  } catch (error) {
    console.error(`❌ Error saving history to Firebase ${path}:`, error);
  }
}

async function getLatestFromFirebase(path) {
  try {
    const snapshot = await db.ref(path).once('value');
    return snapshot.val();
  } catch (error) {
    console.error(`❌ Error reading from Firebase ${path}:`, error);
    return null;
  }
}

// ===== MQTT PUBLISHING =====
async function publishToTopic(topic, data) {
  try {
    if (!isConnected || !mqttClient) {
      console.log('⚠️ MQTT not connected, cannot publish');
      return false;
    }
    
    const message = JSON.stringify(data);
    mqttClient.publish(topic, message, { qos: 1 }, (err) => {
      if (err) {
        console.error(`❌ Error publishing to ${topic}:`, err);
      } else {
        console.log(`📤 Published to ${topic}`);
      }
    });
    
    return true;
  } catch (error) {
    console.error('❌ Error in publishToTopic:', error);
    return false;
  }
}

async function publishBridgeStatus(status) {
  try {
    const statusData = {
      bridge_status: status,
      timestamp: Date.now(),
      updated_at: new Date().toISOString(),
      client_id: MQTT_CONFIG.clientId
    };
    
    await publishToTopic('greenhouse/bridge/status', statusData);
  } catch (error) {
    console.error('❌ Error publishing bridge status:', error);
  }
}

// ===== UTILITY FUNCTIONS =====
function extractSensorValue(data, sensorId) {
  console.log(`🔍 Looking for sensor: ${sensorId}`);
  
  // First check if we have the sensors object structure like in your JSON
  if (data.sensors && typeof data.sensors === 'object') {
    console.log('📦 Found sensors object in data');
    
    // Check if the specific sensor exists
    if (data.sensors[sensorId]) {
      console.log(`✅ Found ${sensorId} in sensors object`);
      
      // Get the value from the sensor object
      const sensorObj = data.sensors[sensorId];
      if (sensorObj.value !== undefined) {
        const value = parseFloat(sensorObj.value);
        if (!isNaN(value) && value >= 0) {
          console.log(`📊 Extracted ${sensorId} value: ${value}`);
          return value;
        }
      }
    }
  }
  
  // Try different possible keys for sensor value
  const possibleKeys = [
    `${sensorId}_value`,
    `${sensorId}_humidity`, 
    `${sensorId}_moisture`,
    `soil_humidity_${sensorId}`,
    `soil_moisture_${sensorId}`,
    `humidity_${sensorId}`,
    `value_${sensorId}`
  ];
  
  // Check if sensor_id is specified in data
  if (data.sensor_id === sensorId) {
    possibleKeys.push('soil_humidity', 'soil_moisture', 'humidity', 'value');
  }
  
  // Check direct keys
  for (const key of possibleKeys) {
    if (data[key] !== undefined) {
      const value = parseFloat(data[key]);
      if (!isNaN(value) && value >= 0) {
        console.log(`📊 Found ${sensorId} value via key ${key}: ${value}`);
        return value;
      }
    }
  }
  
  // Fallback for sensor_1 with generic keys
  if (sensorId === 'sensor_1') {
    const genericKeys = ['soil_humidity', 'soil_moisture', 'humidity', 'value'];
    for (const key of genericKeys) {
      if (data[key] !== undefined) {
        const value = parseFloat(data[key]);
        if (!isNaN(value) && value >= 0 && value <= 100) {
          console.log(`📊 Found ${sensorId} value via generic key ${key}: ${value}%`);
          return value;
        }
      }
    }
  }
  
  console.log(`❌ No valid value found for ${sensorId}`);
  return null;
}

function extractPumpStatus(data) {
  // Try boolean keys first
  const boolKeys = ['active', 'is_active', 'isActive', 'pump_active'];
  for (const key of boolKeys) {
    if (data[key] !== undefined && typeof data[key] === 'boolean') {
      return data[key];
    }
  }
  
  // Try string keys
  const stringKeys = ['status', 'state', 'pump_status', 'pump_state', 'action', 'command'];
  for (const key of stringKeys) {
    if (data[key] !== undefined) {
      const value = data[key].toString().toLowerCase();
      if (['on', 'true', 'active', '1', 'start', 'activate'].includes(value)) {
        return true;
      } else if (['off', 'false', 'inactive', '0', 'stop', 'deactivate'].includes(value)) {
        return false;
      }
    }
  }
  
  return null;
}

function getSensorCondition(value) {
  if (value === null || value === undefined) return 'unknown';
  
  if (value < 30) return 'dry';
  else if (value < 60) return 'moderate';
  else if (value < 80) return 'moist';
  else return 'wet';
}

function parseSimpleFormat(message) {
  const result = {};
  
  try {
    // Handle key=value format
    if (message.includes('=')) {
      const pairs = message.split(',');
      for (let pair of pairs) {
        const keyValue = pair.trim().split('=');
        if (keyValue.length === 2) {
          let key = keyValue[0].trim();
          let value = keyValue[1].trim();
          
          // Convert to appropriate type
          if (!isNaN(parseFloat(value))) {
            result[key] = parseFloat(value);
          } else if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
            result[key] = value.toLowerCase() === 'true';
          } else {
            result[key] = value;
          }
        }
      }
    }
    // Handle key:value format
    else if (message.includes(':')) {
      const pairs = message.split(',');
      for (let pair of pairs) {
        const keyValue = pair.trim().split(':');
        if (keyValue.length === 2) {
          let key = keyValue[0].trim().replace(/"/g, '');
          let value = keyValue[1].trim().replace(/"/g, '');
          
          // Convert to appropriate type
          if (!isNaN(parseFloat(value))) {
            result[key] = parseFloat(value);
          } else if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
            result[key] = value.toLowerCase() === 'true';
          } else {
            result[key] = value;
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Error parsing simple format:', error);
    result.parse_error = error.toString();
  }
  
  return result;
}

function getDateKey(date) {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

// ===== START APPLICATION =====
async function startBridge() {
  try {
    console.log('🚀 Starting Enhanced MQTT to Firebase Bridge...');
    console.log('📡 MQTT Broker:', MQTT_CONFIG.broker);
    console.log('🔥 Firebase Database: Connected');
    console.log('📱 Flutter App Support: Enabled');
    console.log('🤖 ESP32 Device Support: Enabled');
    console.log('🔄 Bi-directional Sync: Enabled');
    
    // Connect to MQTT
    connectMQTT();
    
    console.log('✅ Enhanced Bridge is running...');
    console.log('🎯 Listening for MQTT messages from ESP32 and Flutter App');
    console.log('🔄 Providing bi-directional sync between devices and Firebase');
    
  } catch (error) {
    console.error('❌ Error starting bridge:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down bridge...');
  
  if (mqttClient) {
    publishBridgeStatus('offline').finally(() => {
      mqttClient.end();
    });
  }
  
  console.log('✅ Bridge shutdown complete');
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the bridge
startBridge();