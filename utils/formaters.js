export const extractSensorValue = (data, sensorId) => {
  console.log(`Looking for sensor: ${sensorId}`);

  if (data.sensors && typeof data.sensors === "object") {
    console.log("Found sensors object in data");

    // Check if the specific sensor exists
    if (data.sensors[sensorId]) {
      console.log(`Found ${sensorId} in sensors object`);

      // Get the value from the sensor object
      const sensorObj = data.sensors[sensorId];
      if (sensorObj.value !== undefined) {
        const value = parseFloat(sensorObj.value);
        if (!isNaN(value) && value >= 0) {
          console.log(`Extracted ${sensorId} value: ${value}`);
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
    `value_${sensorId}`,
  ];

  // Check if sensor_id is specified in data
  if (data.sensor_id === sensorId) {
    possibleKeys.push("soil_humidity", "soil_moisture", "humidity", "value");
  }

  // Check direct keys
  for (const key of possibleKeys) {
    if (data[key] !== undefined) {
      const value = parseFloat(data[key]);
      if (!isNaN(value) && value >= 0) {
        console.log(`Found ${sensorId} value via key ${key}: ${value}`);
        return value;
      }
    }
  }

  // Fallback for sensor_1 with generic keys
  if (sensorId === "sensor_1") {
    const genericKeys = ["soil_humidity", "soil_moisture", "humidity", "value"];
    for (const key of genericKeys) {
      if (data[key] !== undefined) {
        const value = parseFloat(data[key]);
        if (!isNaN(value) && value >= 0 && value <= 100) {
          console.log(
            `Found ${sensorId} value via generic key ${key}: ${value}%`
          );
          return value;
        }
      }
    }
  }

  console.log(`No valid value found for ${sensorId}`);
  return null;
}

export const extractPumpStatus = (data) => {
  if (!data || data.status === undefined) return null;

  const value = data.status.toString().toLowerCase();

  if (value === 'on') return true;
  else if (value === 'off') return false;

  return null;
};


export const getSensorCondition = (value) => {
  if (value === null || value === undefined) return "tidak diketahui";

  if (value < 1200) return "kering";
  else if (value <= 1800) return "normal"; 
  else return "basah";
};


export const parseSimpleFormat = (message) =>  {
  const result = {};

  try {
    if (message.includes("=")) {
      const pairs = message.split(",");
      for (let pair of pairs) {
        const keyValue = pair.trim().split("=");
        if (keyValue.length === 2) {
          let key = keyValue[0].trim();
          let value = keyValue[1].trim();

          if (!isNaN(parseFloat(value))) {
            result[key] = parseFloat(value);
          } else if (
            value.toLowerCase() === "true" ||
            value.toLowerCase() === "false"
          ) {
            result[key] = value.toLowerCase() === "true";
          } else {
            result[key] = value;
          }
        }
      }
    }
    else if (message.includes(":")) {
      const pairs = message.split(",");
      for (let pair of pairs) {
        const keyValue = pair.trim().split(":");
        if (keyValue.length === 2) {
          let key = keyValue[0].trim().replace(/"/g, "");
          let value = keyValue[1].trim().replace(/"/g, "");

          // Convert to appropriate type
          if (!isNaN(parseFloat(value))) {
            result[key] = parseFloat(value);
          } else if (
            value.toLowerCase() === "true" ||
            value.toLowerCase() === "false"
          ) {
            result[key] = value.toLowerCase() === "true";
          } else {
            result[key] = value;
          }
        }
      }
    }
  } catch (error) {
    console.error("❌ Error parsing simple format:", error);
    result.parse_error = error.toString();
  }

  return result;
}
