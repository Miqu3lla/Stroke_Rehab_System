import axios from "axios"

export const instance = axios.create({
    baseURL: "https://api.necookie.dev",
})

if (__DEV__) {
    instance.interceptors.request.use((cfg) => {
        console.log("[API] Request ->", cfg.method, cfg.baseURL + cfg.url, cfg.data || cfg.params || "")
        return cfg
    }, (err) => {
        console.log("[API] Request Error ->", err)
        return Promise.reject(err)
    })

    instance.interceptors.response.use((res) => {
        console.log("[API] Response <-", res.status, res.config.url, res.data)
        return res
    }, (err) => {
        if (err.response) {
            console.log("[API] Response Error <-", err.response.status, err.response.data)
        } else {
            console.log("[API] Network/Error <-", err.message)
        }
        return Promise.reject(err)
    })
}
