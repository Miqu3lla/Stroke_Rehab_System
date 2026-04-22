
#set a stable python version
FROM python:3.11-slim

#set the working directory
WORKDIR /app

#install system dependencies required for both windows and linux when runnign the container 
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

#copy the requirements file into the container

COPY requrements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. Copy the rest of the backend code
COPY . .

# 6. Expose the port your API runs on 
EXPOSE 8000

# 7. Run the API
CMD ["python", "main_api.py"]