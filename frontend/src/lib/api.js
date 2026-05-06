import axios from "axios"


export const instance = axios.create({
    baseURL: "https://api.necookie.dev"  // Cloudflare tunnel public URL
})

