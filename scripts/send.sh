#!/bin/bash

# Konfigurasi broker
BROKER_HOST="localhost"
BROKER_PORT=1883
INTERVAL=30   # interval detik
TOPIC="greenhouse/sensors/data"

sensor1_value=1210
sensor2_value=1300

echo "Starting MQTT dummy sender..."
echo "Broker : $BROKER_HOST:$BROKER_PORT"
echo "Topic  : $TOPIC"
echo "----------------------------------"

# Fungsi random stabil
rand_stable() {
  local base=$1
  # Random perubahan antara -3 sampai +3
  local delta=$(( (RANDOM % 7) - 3 ))
  echo $(( base + delta ))
}

while true; do
  # Update nilai random tapi stabil
  sensor1_value=$(rand_stable $sensor1_value)
  sensor2_value=$(rand_stable $sensor2_value)

  # Pastikan nilai tetap masuk akal
  if [ $sensor1_value -lt 0 ]; then sensor1_value=0; fi
  if [ $sensor2_value -lt 0 ]; then sensor2_value=0; fi

  # Buat JSON payload
  PAYLOAD=$(cat <<EOF
{
  "sensors": {
    "sensor_1": {
      "value": $sensor1_value,
      "is_active": true,
      "sensor_id": "sensor_1"
    },
    "sensor_2": {
      "value": $sensor2_value,
      "is_active": true,
      "sensor_id": "sensor_2"
    }
  }
}
EOF
)

  # Publish ke MQTT
  mosquitto_pub -h "$BROKER_HOST" -p "$BROKER_PORT" -t "$TOPIC" -m "$PAYLOAD"

  echo "Sent: $PAYLOAD"
  sleep $INTERVAL
done
