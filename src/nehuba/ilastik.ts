export interface IlastikRequest {
	projectId: string
	datasetUrl: string
}

export interface IlastikResponce {
	name: string
	url: string
	shader: string
	
	[propName: string]: any;
}