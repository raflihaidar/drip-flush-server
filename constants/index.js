import dotenv from "dotenv"

dotenv.config()

export const TOPICS = {
    // ESP32 topics
    sensorData: 'greenhouse/sensors/data',
    pumpControl: 'greenhouse/control/pump',
    pumpStatus: 'greenhouse/pump/status',
    
    // Flutter app topics
    appSensorData: 'greenhouse/app/sensors/data',
    appPumpControl: 'greenhouse/app/control/pump',
    appPumpStatus: 'greenhouse/app/pump/status',
    
    // General topics
    sensorsSoil: 'greenhouse/sensors/soil',
    sensorsWildcard: 'greenhouse/sensors/+',
    statusWildcard: 'greenhouse/status/+',
    appWildcard: 'greenhouse/app/+',
        
    // Bi-directional sync topics
    syncSensors: 'greenhouse/sync/sensors',
    syncPump: 'greenhouse/sync/pump'
};

export const MQTT_CONFIG = {
    broker: process.env.BROKER_URL,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    clientId: `${process.env.MQTT_CLIENTID}_${Date.now()}`
};