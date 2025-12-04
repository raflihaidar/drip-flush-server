<!-- PAYLOAD KIRIM DATA SENSOR -->
mosquitto_pub -h localhost -p 1883 -t "greenhouse/sensors/data" -m '{
    "sensors": {
      "sensor_1": {
        "value": 45,
        "is_active": true,
        "sensor_id": "sensor_1"
      },
      "sensor_2": {
        "value": 80,
        "is_active": true,
        "sensor_id": "sensor_2"
      }
    }
}'

<!-- PAYLOAD CONTROLL PUMP -->
mosquitto_pub -h localhost -p 1883 -t "greenhouse/pump/status" -m '{
  "device": "water_pump",
  "is_active": true,
  "status": "on",
  "timestamp": 123456,
  "source": "manual",
  "esp32_time": 123456
}'

