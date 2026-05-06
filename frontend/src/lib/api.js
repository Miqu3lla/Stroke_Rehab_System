import axios from "axios"

// Create a singleton Axios instance used throughout the app.
// baseURL points to the production API (Cloudflare tunnel). All requests
// will be relative to this URL, e.g. instance.post('/patients', payload).
export const instance = axios.create({
    baseURL: "https://api.necookie.dev",
})

// In development mode we attach request/response interceptors to
// print helpful debug information to the console. This makes it easy
// to see what is being sent and what the server returns without a debugger.
if (__DEV__) {
    // Log outgoing request details: HTTP method, full URL, and payload.
    instance.interceptors.request.use((cfg) => {
        console.log("[API] Request ->", cfg.method, cfg.baseURL + cfg.url, cfg.data || cfg.params || "")
        return cfg
    }, (err) => {
        console.log("[API] Request Error ->", err)
        return Promise.reject(err)
    })

    // Log successful responses and forward them unchanged.
    instance.interceptors.response.use((res) => {
        console.log("[API] Response <-", res.status, res.config.url, res.data)
        return res
    }, (err) => {
        // When the server returns an error, log the status and payload if available.
        if (err.response) {
            console.log("[API] Response Error <-", err.response.status, err.response.data)
        } else {
            // Network errors (e.g., timeout, DNS) fall into this branch.
            console.log("[API] Network/Error <-", err.message)
        }
        return Promise.reject(err)
    })
}
