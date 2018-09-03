export interface IlastikRequest {
	projectId: string
	datasetId: string
}

export interface IlastikResponce {
	name: string
	url: string
	shader: string
	
	[propName: string]: any;
}