import axios from "axios"
import { supabase } from "../services/supabase"

// Create a singleton Axios instance used throughout the app.
export const instance = axios.create({
    baseURL: "https://api.necookie.dev",
})

// Auth interceptor — attaches the Supabase JWT as a Bearer token on
// every outbound request. The backend's verify_jwt dependency rejects
// anything without a valid token, so this is what proves we're a logged-in
// patient (not a random curl from the open tunnel).
//
// supabase.auth.getSession() returns the cached session and silently
// refreshes the access_token in the background when it's near expiry
instance.interceptors.request.use(async (cfg) => {
    try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (token) {
            cfg.headers = cfg.headers || {}
            cfg.headers.Authorization = `Bearer ${token}`
        }
    } catch (err) {
        // If session lookup fails, send the request without auth — backend
        // will reject it. Don't block the request chain on storage hiccups.
        console.log("[API] Could not attach auth token:", err?.message || err)
    }
    return cfg
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
