import yaml from 'yaml'

export function stringifyData(data: string, dataType: string | null, pretty?: boolean): string {
  // Transform data field based on data_type
  let transformedData = data
  if (data && dataType) {
    try {
      if (dataType === 'json') {
        // Format JSON with 2-space indentation
        transformedData = pretty ? JSON.stringify(JSON.parse(data), null, 2) : data
      } else if (dataType === 'yaml') {
        // Convert JSON string to YAML
        const parsed = JSON.parse(data)
        transformedData = yaml.stringify(parsed)
      }
    } catch {
      return transformedData
    }
  }
  return transformedData
}
