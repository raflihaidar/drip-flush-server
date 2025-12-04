import {
  extractPumpStatus,
  extractSensorValue,
  getSensorCondition,
  parseSimpleFormat,
} from "./utils/formaters.js";
import { TOPICS, MQTT_CONFIG } from "./constants/index.js";
import {
  mqttClient,
  publishToTopic,
  publishBridgeStatus,
} from "./services/mqtt.js";
import {
  saveToFirebase,
  saveToFirebaseHistory,
  sendNotification,
} from "./services/firebase.js";

import dotenv from "dotenv";

dotenv.config();

const connectMQTT = () => {
  mqttClient.on("connect", () => {
    console.log("Connected to MQTT broker");

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

      // Sync topics
      TOPICS.syncSensors,
      TOPICS.syncPump,
    ];

    topicsToSubscribe.forEach((topic) => {
      mqttClient.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`Error subscribing to ${topic}:`, err);
        } else {
          console.log(`Subscribed to topic: ${topic}`);
        }
      });
    });

    // Publish bridge status
    publishBridgeStatus("online");
  });

  mqttClient.on("message", async (topic, message) => {
    try {
      const messageStr = message.toString();

      // Parse message
      let data;
      try {
        data = JSON.parse(messageStr);
      } catch (jsonError) {
        data = {
          raw_message: messageStr,
          message_type: "text",
          topic: topic,
          received_at: new Date().toISOString(),
        };

        // Try to extract simple key-value pairs
        if (messageStr.includes("=") || messageStr.includes(":")) {
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
      console.error("Error processing MQTT message:", error);
    }
  });

  mqttClient.on("error", (error) => {
    console.error("MQTT Error:", error);
    isConnected = false;
  });

  mqttClient.on("disconnect", () => {
    console.log("MQTT Disconnected");
    isConnected = false;
  });

  mqttClient.on("reconnect", () => {
    console.log("MQTT Reconnecting...");
  });
};

// ===== MESSAGE ROUTING =====
const routeMessage = async (topic, data) => {
  try {
    console.log(`Routing message from topic: ${topic}`);
    // Handle ESP32 sensor data
    if (topic.includes("sensors") && !topic.includes("app"))
      await handleESP32SensorData(data);
    // Handle Flutter app sensor data
    else if (topic.includes("app") && topic.includes("sensors"))
      await handleAppSensorData(data);
    // Handle pump data from any source
    else if (topic.includes("pump")) await handlePumpData(data, topic);
    // Handle sync requests
    else if (topic.includes("sync")) await handleSyncRequest(data, topic);
    //unhandled topic
    else {
      console.log(`Unhandled topic: ${topic}, saving to general messages`);
      await saveToFirebaseHistory("greenhouse_data/general_messages", data);
    }
  } catch (error) {
    console.error("Error routing message:", error);
  }
};

const checkPlantCondition = (value1, value2) => {
  let message = null;

  const isDry = (v) => v < 1200;
  const isWet = (v) => v > 1800;

  const condition1 = isDry(value1)
    ? "Sensor 1 Kering 🌵"
    : isWet(value1)
    ? "Sensor 1 Terlalu Basah 💦"
    : "Sensor 1 Normal ✅";

  const condition2 = isDry(value2)
    ? "Sensor 2 Kering 🌵, sebaiknya disiram segera!"
    : isWet(value2)
    ? "Sensor 2 Terlalu Basah 💦"
    : "Sensor 2 Normal ✅";

  const issues = [condition1, condition2].filter(
    (cond) => !cond.includes("Normal")
  );

  if (issues.length > 0) {
    message = issues.join(" & ");
  }

  return message;
};

const decidePumpAction = (sensorData) => {
  const sensor1Cond = sensorData.sensor.soil_sensor_1.condition;
  const sensor2Cond = sensorData.sensor.soil_sensor_2.condition;

  // Jika salah satu sensor terlalu kering -> hidupkan pompa
  if (sensor1Cond === "kering" || sensor2Cond === "kering") {
    return true; // ON
  }

  // Jika salah satu sensor terlalu basah -> matikan pompa
  if (sensor1Cond === "basah" || sensor2Cond === "basah" || sensor1Cond === 'normal' || sensor2Cond === 'normal') {
    return false; // OFF
  }

  // Default: biarkan pompa tetap seperti sebelumnya
  return null;
};

// ===== ESP32 SENSOR DATA HANDLER =====
const handleESP32SensorData = async (data) => {
  try {
    console.log("Processing ESP32 sensor data...");

    // Extract sensor values from ESP32 format
    const sensor1Value = extractSensorValue(data, "sensor_1");
    const sensor2Value = extractSensorValue(data, "sensor_2");

    if (sensor1Value === null && sensor2Value === null) {
      console.log("No valid sensor values found in ESP32 data");
      console.log("Available data keys:", Object.keys(data));
      return;
    }

    // processing data untuk dikirim ke firebase
    const sensorData = {
      sensor: {
        soil_sensor_1: {
          value: sensor1Value || 0.0,
          sensor_id: "sensor_1",
          is_active: sensor1Value !== null,
          condition: getSensorCondition(sensor1Value),
        },
        soil_sensor_2: {
          value: sensor2Value || 0.0,
          sensor_id: "sensor_2",
          is_active: sensor2Value !== null,
          condition: getSensorCondition(sensor2Value),
        },
      },
      timestamp: Date.now(),
      updated_at: new Date().toISOString(),
      source: "esp32_device",
      data_type: "sensor_reading",
    };

    // Calculate rata rata kelembapan
    const activeSensors = [sensor1Value, sensor2Value].filter(
      (v) => v !== null
    );
    if (activeSensors.length > 0) {
      const average =
        activeSensors.reduce((a, b) => a + b, 0) / activeSensors.length;
      sensorData.sensor.average_humidity = parseFloat(average.toFixed(1));
      sensorData.sensor.overall_condition = getSensorCondition(average);
    }

    // Save to Firebase current sensor data
    await saveToFirebase("greenhouse_data/current_sensor", sensorData);

    // Also save to history with ESP32 tag
    await saveToFirebaseHistory("greenhouse_data/sensor_history", {
      ...sensorData,
      device_source: "esp32",
    });

    // Forward to app if needed
    await forwardToApp("sensors", sensorData);

    const message = checkPlantCondition(sensor1Value, sensor2Value);

    if (message) await sendNotification("Green House Jambangan", message);

    // ---- AUTOMATIC PUMP CONTROL ----
    const pumpAction = decidePumpAction(sensorData);
    if (pumpAction !== null) {
      console.log(`Auto pump action decided: ${pumpAction ? "ON" : "OFF"}`);

      const pumpData = {
        device: "water_pump",
        is_active: pumpAction,
        status: pumpAction ? "on" : "off",
        timestamp: Date.now(),
        source: "auto_control",
        esp32_time: Date.now(),
      };

      // Panggil handlePumpData untuk mengeksekusi kontrol pompa
      await handlePumpData(pumpData, "greenhouse/pump/status");
    }

    console.log("ESP32 sensor data saved to Firebase");
  } catch (error) {
    console.error("Error handling ESP32 sensor data:", error);
  }
};

// Flutter App Sensor Data Handler
const handleAppSensorData = async (data) => {
  try {
    console.log("Processing Flutter app sensor data...");

    // Handle sensor data published by Flutter app (GreenhouseProvider)
    let sensorData;

    // Check if data is already in Firebase format
    if (data.sensors && typeof data.sensors === "object") {
      console.log("Data is in Flutter sensors format");

      // Extract values from Flutter format
      const sensor1 = data.sensors.sensor_1;
      const sensor2 = data.sensors.sensor_2;

      sensorData = {
        sensor: {
          soil_sensor_1: {
            value: sensor1?.value || 0.0,
            sensor_id: sensor1?.sensor_id || "sensor_1",
            is_active: sensor1?.is_active || false,
            condition: getSensorCondition(sensor1?.value),
          },
          soil_sensor_2: {
            value: sensor2?.value || 0.0,
            sensor_id: sensor2?.sensor_id || "sensor_2",
            is_active: sensor2?.is_active || false,
            condition: getSensorCondition(sensor2?.value),
          },
        },
        timestamp: Date.now(),
        updated_at: new Date().toISOString(),
        source: "flutter_app",
        data_type: "app_sensor_update",
      };

      // Calculate metrics
      const activeSensors = [];
      if (sensor1?.is_active && sensor1?.value > 0)
        activeSensors.push(sensor1.value);
      if (sensor2?.is_active && sensor2?.value > 0)
        activeSensors.push(sensor2.value);

      if (activeSensors.length > 0) {
        const average =
          activeSensors.reduce((a, b) => a + b, 0) / activeSensors.length;
        sensorData.sensor.average_humidity = parseFloat(average.toFixed(1));
        sensorData.sensor.overall_condition = getSensorCondition(average);
      }

      console.log(
        `App - Sensor1: ${sensor1?.value}%, Sensor2: ${sensor2?.value}%`
      );
    }
    // Handle other app sensor formats
    else if (data.sensor_type || data.value !== undefined) {
      console.log("Data is in single sensor format");

      sensorData = {
        sensor: {
          soil_sensor_1: {
            value: parseFloat(data.value) || 0.0,
            sensor_id: data.sensor_id || "mobile_sensor",
            is_active: true,
            condition: getSensorCondition(data.value),
          },
        },
        timestamp: Date.now(),
        updated_at: new Date().toISOString(),
        source: "flutter_app_single",
        data_type: "single_sensor_update",
      };
    } else {
      console.log("Unknown app sensor data format");
      return;
    }

    // Save to Firebase with app source
    await saveToFirebase("greenhouse_data/current_sensor_app", sensorData);

    // Also save to history with app tag
    await saveToFirebaseHistory("greenhouse_data/sensor_history", {
      ...sensorData,
      device_source: "flutter_app",
    });

    // Forward to ESP32 if needed (sync)
    await forwardToESP32("sensors", sensorData);

    console.log("Flutter app sensor data saved to Firebase");
  } catch (error) {
    console.error("Error handling Flutter app sensor data:", error);
  }
};

// Pump Data Handler
const handlePumpData = async (data, topic) => {
  try {
    console.log("Processing pump data...");
    console.log(`Topic: ${topic}, Data:`, data);

    // Extract pump status
    let isActive = extractPumpStatus(data);

    // If this is a control command, convert to status
    if (data.action && isActive === null) {
      const action = data.action.toString().toLowerCase();
      isActive = action === "on" || action === "start" || action === "activate";
      console.log(
        `Converted control command '${action}' to status: ${isActive}`
      );
    }

    // Handle Flutter app control format
    if (data.command && isActive === null) {
      const command = data.command.toString().toLowerCase();
      isActive =
        command === "start" || command === "on" || command === "activate";
      console.log(
        `Converted Flutter command '${command}' to status: ${isActive}`
      );
    }

    if (isActive === null) {
      console.log("No valid pump status found");
      console.log("Available keys:", Object.keys(data));
      return;
    }

    console.log(`Extracted pump status: ${isActive ? "ON" : "OFF"}`);

    // Determine source
    let source = "unknown";
    if (topic.includes("app")) source = "flutter_app";
    else if (data.source) source = data.source;
    else source = "esp32_device";

    // Create Firebase-compatible pump data structure
    const pumpData = {
      pump: {
        water_pump: {
          is_active: isActive,
          status: isActive ? "on" : "off",
          last_changed: new Date().toISOString(),
        },
      },
      timestamp: Date.now(),
      updated_at: new Date().toISOString(),
      source: source,
      data_type: "pump_status_update",
      command_id: data.command_id || null,
    };

    // Save to Firebase current pump data
    await saveToFirebase("greenhouse_data/current_pump", pumpData);

    // Also save to history
    await saveToFirebaseHistory("greenhouse_data/pump_history", {
      ...pumpData,
      device_source: source,
    });

    // Forward pump commands appropriately
    if (topic.includes("app") && topic.includes("control")) {
      // App is controlling pump, forward to ESP32
      await forwardPumpCommandToESP32(isActive, data);
    } else if (topic.includes("control") && !topic.includes("app")) {
      // ESP32 control, forward status to app
      await forwardPumpStatusToApp(isActive, data);
    }

    console.log("Pump data saved to Firebase");
  } catch (error) {
    console.error("Error handling pump data:", error);
  }
};

// Mendapatkan data sensor dan status terbaru
const handleSyncRequest = async (data, topic) => {
  try {
    console.log("Processing sync request...");

    if (topic === TOPICS.syncSensors) {
      // Send latest sensor data to requester
      const latestSensor = await getLatestFromFirebase(
        "greenhouse_data/current_sensor"
      );
      if (latestSensor) {
        await publishToTopic(TOPICS.sensorData, latestSensor);
      }
    } else if (topic === TOPICS.syncPump) {
      // Send latest pump data to requester
      const latestPump = await getLatestFromFirebase(
        "greenhouse_data/current_pump"
      );
      if (latestPump) {
        await publishToTopic(TOPICS.pumpStatus, latestPump);
      }
    }

    console.log("Sync request handled");
  } catch (error) {
    console.error("Error handling sync request:", error);
  }
};

// Kirim ke Aplikasi
const forwardToApp = async (dataType, data) => {
  try {
    if (dataType === "sensors") {
      await publishToTopic(TOPICS.appSensorData, data);
      console.log("Forwarded sensor data to app");
    }
  } catch (error) {
    console.error("Error forwarding to app:", error);
  }
};

// Kirim ke Esp
const forwardToESP32 = async (dataType, data) => {
  try {
    if (dataType === "sensors") {
      await publishToTopic(TOPICS.sensorData, data);
      console.log("Forwarded sensor data to ESP32");
    }
  } catch (error) {
    console.error("Error forwarding to ESP32:", error);
  }
};

// kirim perintah ke pompa
const forwardPumpCommandToESP32 = async (isActive, originalData) => {
  try {
    const command = {
      device: "water_pump",
      action: isActive ? "on" : "off",
      timestamp: new Date().toISOString(),
      source: "bridge_forward",
      command_id: originalData.command_id || Date.now().toString(),
      original_source: originalData.source || "unknown",
    };

    await publishToTopic(TOPICS.pumpControl, command);
    console.log("Forwarded pump command to ESP32:", command);
  } catch (error) {
    console.error("Error forwarding pump command to ESP32:", error);
  }
};

// kirim status ke pompa
const forwardPumpStatusToApp = async (isActive, originalData) => {
  try {
    const status = {
      device: "water_pump",
      is_active: isActive,
      status: isActive ? "on" : "off",
      timestamp: new Date().toISOString(),
      source: "bridge_forward",
      command_id: originalData.command_id || null,
      original_source: originalData.source || "esp32",
    };

    await publishToTopic(TOPICS.appPumpStatus, status);
    console.log("Forwarded pump status to app:", status);
  } catch (error) {
    console.error("Error forwarding pump status to app:", error);
  }
};

const startBridge = async () => {
  try {
    console.log("Starting Enhanced MQTT to Firebase Bridge...");
    console.log("MQTT Broker:", MQTT_CONFIG.broker);

    // Connect to MQTT
    connectMQTT();
  } catch (error) {
    console.error("Error starting bridge:", error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down bridge...");

  if (mqttClient) {
    publishBridgeStatus("offline").finally(() => {
      mqttClient.end();
    });
  }

  console.log("Bridge shutdown complete");
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

startBridge();
