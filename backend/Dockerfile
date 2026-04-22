# Use a slim Python base so the backend stays lightweight and reproducible.
FROM python:3.11-slim

# Set the container working directory for the backend app.
WORKDIR /app

# Install native libraries needed by OpenCV and MediaPipe inside the container.
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifest first so Docker can cache pip installs.
COPY requirements.txt .
ENV PIP_EXTRA_INDEX_URL=https://download.pytorch.org/whl/cu128
RUN pip install --no-cache-dir --default-timeout=1000 -r requirements.txt

# Copy the backend source after dependencies are installed.
COPY . .

# Expose the FastAPI port.
EXPOSE 8000

# Start the API container with Uvicorn so FastAPI serves correctly in Docker.
CMD ["uvicorn", "main_api:app", "--host", "0.0.0.0", "--port", "8000"]