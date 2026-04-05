# Thesis System (Frontend)

This repository currently contains the frontend setup for the thesis system. 

## Setup & Running Locally

This project is built using React Native with Expo. Since this is currently a frontend-only setup, all you need is the Expo CLI and Node.js environment to get started.

### Prerequisites
- Node.js installed on your machine.
- [Expo Go](https://expo.dev/client) app installed on your physical mobile device if you want to test on a real device, or an Android/iOS emulator installed on your computer.

### Installation

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install the necessary dependencies:
   ```bash
   npm install
   ```

### Running the Application

To start the development server, run the following command inside the `frontend` directory:

```bash
npx expo start
```
*Note: You can run `npx expo start --tunnel` if you want to expose your local server to the internet, which can be useful for testing on a physical device.*

Once the server starts, you can:
- **Scan the QR code** using the Expo Go app on your physical device.
- Press **`a`** to open the app on an Android emulator.
- Press **`i`** to open the app on an iOS simulator.
- Press **`w`** to run the app in a web browser.

## Current Folder Structure

The current structure of the project is as follows:

```text
thesis_system-for-now-/
├── frontend/             # The main frontend directory
│   ├── assets/           # Static assets like images and fonts
│   ├── src/              # Source code for the application components and screens
│   ├── App.js            # Main entry point component of the application
│   ├── app.json          # Expo configuration file
│   ├── index.js          # Entry file registered with Expo
│   ├── package.json      # Project dependencies and scripts
│   └── package-lock.json # Dependency lockfile
└── README.md             # This documentation file
```

> **Note:** This folder structure is preliminary and is expected to be updated as the project evolves and more features (like a backend) are integrated.