import mqtt from 'mqtt';
import { MQTT_CONFIG } from "../constants/index.js";


export const mqttClient = mqtt.connect(MQTT_CONFIG.broker, {
    clientId: MQTT_CONFIG.clientId,
    username: MQTT_CONFIG.username ?? '',
    password: MQTT_CONFIG.password ?? '',
    clean: true,
    keepalive: 30,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
    rejectUnauthorized: false
});

export const publishToTopic = async (topic, data) => {
    try {
      if (!mqttClient) {
        console.log(' MQTT not connected, cannot publish');
        return false;
      }
      
      const message = JSON.stringify(data);
      mqttClient.publish(topic, message, { qos: 1 }, (err) => {
        if (err) {
          console.error(`Error publishing to ${topic}:`, err);
        } else {
          console.log(`Published to ${topic}`);
        }
      });
      
      return true;
    } catch (error) {
      console.error('Error in publishToTopic:', error);
      return false;
    }
}
  
export const publishBridgeStatus = async (status) => {
    try {
      const statusData = {
        bridge_status: status,
        timestamp: Date.now(),
        updated_at: new Date().toISOString(),
        client_id: MQTT_CONFIG.clientId
      };
      
      await publishToTopic('greenhouse/bridge/status', statusData);
    } catch (error) {
      console.error('Error publishing bridge status:', error);
    }
}