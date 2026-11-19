variable "name_prefix" {
  description = "Prefix for resource names, including project and environment (for example aula-virtual-prod). The app is named <name_prefix>-front."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,28}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3 to 30 characters: lowercase letters, digits and hyphens only, starting with a letter and ending with a letter or digit."
  }
}

variable "repository_url" {
  description = "HTTPS URL of the GitHub repository Amplify builds. The repository is connected once from the Amplify console with the GitHub App, so no token is passed here."
  type        = string

  validation {
    condition     = can(regex("^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", var.repository_url))
    error_message = "repository_url must look like https://github.com/<owner>/<name> (no trailing slash or .git)."
  }
}

variable "branch_name" {
  description = "Git branch deployed as the PRODUCTION stage; Amplify builds it on every push."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$", var.branch_name)) && !strcontains(var.branch_name, "..")
    error_message = "branch_name must be a single branch name: no wildcards, no leading or trailing slash, no '..'."
  }
}

variable "api_base_url" {
  description = "HTTPS base URL of the backend API (host plus the optional path it is served under), baked into the build as VITE_API_BASE_URL."
  type        = string

  validation {
    condition     = can(regex("^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~-]+)*$", var.api_base_url)) && !can(regex("/[.]+(/|$)", var.api_base_url))
    error_message = "api_base_url must be an https base URL with an optional path, without trailing slash, query or fragment, such as https://api.example.com/api."
  }
}

variable "realtime_url" {
  description = "Secure WebSocket base URL of the realtime service (host plus the optional path it is served under), baked into the build as VITE_REALTIME_URL."
  type        = string

  validation {
    condition     = can(regex("^wss://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~-]+)*$", var.realtime_url)) && !can(regex("/[.]+(/|$)", var.realtime_url))
    error_message = "realtime_url must be a wss base URL with an optional path, without trailing slash, query or fragment, such as wss://api.example.com/realtime."
  }
}

variable "app_env" {
  description = "Value of VITE_APP_ENV, the environment label the frontend build reports."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["development", "staging", "production"], var.app_env)
    error_message = "app_env must be development, staging or production."
  }
}
